'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { compressImage, safeFileName } from '@/lib/compressImage';
import { DOCUMENTS_BUCKET } from '@/lib/db';
import { sha256Hex } from '@/lib/duplicates';
import { uidFromQr } from '@/lib/ekasa/uid';
import { readQrFromImage } from '@/lib/qrImage';
import { createClient } from '@/lib/supabase-browser';

type ItemState = 'uploading' | 'extracting' | 'done' | 'error' | 'duplicate';
type Source = 'upload' | 'camera';
interface Item {
  key: string;
  name: string;
  state: ItemState;
  message?: string;
  /** Doklad, ktorý už má rovnaký súbor (pred uploadom) alebo rovnaké údaje (po vyťažení). */
  duplicateOf?: string;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Nahratie dokladov: súbor ide priamo do Storage (nie cez serverless funkciu — limit ~4,5 MB),
 * potom sa založí záznam dokladu a spustí vyťaženie.
 */
export function UploadDocuments({ companyId }: { companyId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  // Súbory čakajúce na rozhodnutie „Nahrať aj tak" pri zhode odtlačku.
  const pendingFiles = useRef(new Map<string, { file: File; source: Source }>());

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function processOne(original: File, key: string, source: Source, forcedDuplicateOf?: string) {
    const supabase = createClient();
    try {
      // Odtlačok pôvodného súboru (pred zmenšením) — rovnaký súbor nahratý znova má rovnaký hash.
      const sha256 = await sha256Hex(await original.arrayBuffer());
      if (!forcedDuplicateOf) {
        const { data: same } = await supabase
          .from('document_files')
          .select('document_id')
          .eq('company_id', companyId)
          .eq('sha256', sha256)
          .not('document_id', 'is', null)
          .limit(1)
          .maybeSingle();
        if (same?.document_id) {
          pendingFiles.current.set(key, { file: original, source });
          update(key, { state: 'duplicate', duplicateOf: same.document_id, message: 'Tento súbor už v tejto firme je.' });
          return;
        }
      }

      // QR kód eKasa čítame z pôvodnej fotky (pred zmenšením je čitateľnejší).
      const ekasaUid = uidFromQr(await readQrFromImage(original));
      const file = await compressImage(original);
      if (file.size > MAX_BYTES) throw new Error('Súbor je väčší ako 20 MB.');
      if (!ACCEPT.split(',').includes(file.type)) throw new Error('Podporované sú PDF, JPG, PNG a WebP.');

      const docId = crypto.randomUUID();
      const path = `${companyId}/${docId}/${Date.now()}-${safeFileName(file.name)}`;

      const { error: docError } = await supabase
        .from('documents')
        .insert({
          id: docId,
          company_id: companyId,
          kind: 'other',
          status: 'unprocessed',
          source,
          ekasa_uid: ekasaUid,
          ...(forcedDuplicateOf ? { duplicate_of: forcedDuplicateOf, duplicate_ignored: true } : {}),
        });
      if (docError) throw new Error(docError.message);

      const { error: upError } = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upError) {
        await supabase.from('documents').delete().eq('id', docId);
        throw new Error(upError.message);
      }
      const { error: fileError } = await supabase.from('document_files').insert({
        document_id: docId,
        company_id: companyId,
        storage_path: path,
        mime: file.type,
        size_bytes: file.size,
        sha256,
      });
      if (fileError) throw new Error(fileError.message);

      update(key, { state: 'extracting' });
      let ekasaNote: string | undefined;
      if (ekasaUid) {
        // Bloček s QR → presné údaje z eKasa bez vyťaženia modelom; pri chybe pokračuje bežné vyťaženie.
        const ek = await fetch(`/api/documents/${docId}/ekasa`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: ekasaUid }),
        });
        const ekBody = await ek.json().catch(() => ({}));
        if (ek.ok) {
          update(key, { state: 'done', message: ['Údaje z eKasa.', ...(ekBody.warnings ?? [])].join(' ') });
          return;
        }
        ekasaNote = `eKasa: ${ekBody.error?.message ?? ek.statusText} Čítam z fotky.`;
        update(key, { message: ekasaNote });
      }
      const res = await fetch(`/api/documents/${docId}/extract`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        update(key, { state: 'error', message: `Nahraté, ale nevyťažené: ${body.error ?? res.statusText}` });
      } else if (body.duplicate_of && !forcedDuplicateOf) {
        update(key, { state: 'done', duplicateOf: body.duplicate_of, message: 'Možný duplikát — rovnaké číslo, suma a dátum ako iný doklad.' });
      } else {
        update(key, { state: 'done', message: [ekasaNote, body.notes].filter(Boolean).join(' ') || undefined });
      }
    } catch (e) {
      update(key, { state: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      router.refresh();
    }
  }

  function uploadAnyway(item: Item) {
    const pending = pendingFiles.current.get(item.key);
    if (!pending || !item.duplicateOf) return;
    pendingFiles.current.delete(item.key);
    update(item.key, { state: 'uploading', message: undefined, duplicateOf: undefined });
    processOne(pending.file, item.key, pending.source, item.duplicateOf);
  }

  function skip(item: Item) {
    pendingFiles.current.delete(item.key);
    setItems((list) => list.filter((i) => i.key !== item.key));
  }

  async function handleFiles(list: FileList | null, source: Source) {
    if (!list?.length) return;
    const files = Array.from(list);
    const added = files.map((f) => ({ key: crypto.randomUUID(), name: f.name, state: 'uploading' as const }));
    setItems((prev) => [...added, ...prev]);
    // Po dvoch naraz — vyťaženie trvá desiatky sekúnd, nech to nezahltí API.
    const queue = files.map((f, i) => () => processOne(f, added[i].key, source));
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) await job();
    };
    await Promise.all([worker(), worker()]);
  }

  return (
    <div>
      <div
        className={`dropzone${dragging ? ' dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handleFiles(e.dataTransfer.files, 'upload');
        }}
      >
        <p style={{ margin: '0 0 12px' }}>Pretiahni sem bločky a faktúry (PDF, JPG, PNG) alebo:</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => inputRef.current?.click()}>Vybrať súbory</button>
          <button type="button" className="secondary" onClick={() => cameraRef.current?.click()}>Odfotiť</button>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { handleFiles(e.target.files, 'upload'); e.target.value = ''; }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { handleFiles(e.target.files, 'camera'); e.target.value = ''; }} />
      </div>
      {items.length > 0 && (
        <ul className="upload-list">
          {items.map((i) => (
            <li key={i.key}>
              <span>{i.name}</span>
              <span className={`badge ${i.state}`}>
                {i.state === 'uploading' ? 'Nahrávam…' : i.state === 'extracting' ? 'Čítam údaje…' : i.state === 'done' ? 'Hotovo' : i.state === 'duplicate' ? 'Už nahraté' : 'Chyba'}
              </span>
              {i.message && <div className="muted small">{i.message}</div>}
              {i.duplicateOf && (
                <div className="small row-actions">
                  <Link href={`/app/${companyId}/doklady/${i.duplicateOf}`}>Otvoriť pôvodný doklad</Link>
                  {i.state === 'duplicate' && (
                    <>
                      <button type="button" className="link" onClick={() => uploadAnyway(i)}>Nahrať aj tak</button>
                      <button type="button" className="link" onClick={() => skip(i)}>Nenahrávať</button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
