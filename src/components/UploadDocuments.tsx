'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { compressImage, safeFileName } from '@/lib/compressImage';
import { DOCUMENTS_BUCKET } from '@/lib/db';
import { createClient } from '@/lib/supabase-browser';

type ItemState = 'uploading' | 'extracting' | 'done' | 'error';
interface Item {
  key: string;
  name: string;
  state: ItemState;
  message?: string;
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

  const update = (key: string, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  async function processOne(original: File, key: string) {
    const supabase = createClient();
    try {
      const file = await compressImage(original);
      if (file.size > MAX_BYTES) throw new Error('Súbor je väčší ako 20 MB.');
      if (!ACCEPT.split(',').includes(file.type)) throw new Error('Podporované sú PDF, JPG, PNG a WebP.');

      const docId = crypto.randomUUID();
      const path = `${companyId}/${docId}/${Date.now()}-${safeFileName(file.name)}`;

      const { error: docError } = await supabase
        .from('documents')
        .insert({ id: docId, company_id: companyId, kind: 'other', status: 'unprocessed' });
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
      });
      if (fileError) throw new Error(fileError.message);

      update(key, { state: 'extracting' });
      const res = await fetch(`/api/documents/${docId}/extract`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        update(key, { state: 'error', message: `Nahraté, ale nevyťažené: ${body.error ?? res.statusText}` });
      } else {
        update(key, { state: 'done', message: body.notes ?? undefined });
      }
    } catch (e) {
      update(key, { state: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      router.refresh();
    }
  }

  async function handleFiles(list: FileList | null) {
    if (!list?.length) return;
    const files = Array.from(list);
    const added = files.map((f) => ({ key: crypto.randomUUID(), name: f.name, state: 'uploading' as const }));
    setItems((prev) => [...added, ...prev]);
    // Po dvoch naraz — vyťaženie trvá desiatky sekúnd, nech to nezahltí API.
    const queue = files.map((f, i) => () => processOne(f, added[i].key));
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
          handleFiles(e.dataTransfer.files);
        }}
      >
        <p style={{ margin: '0 0 12px' }}>Pretiahni sem bločky a faktúry (PDF, JPG, PNG) alebo:</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => inputRef.current?.click()}>Vybrať súbory</button>
          <button type="button" className="secondary" onClick={() => cameraRef.current?.click()}>Odfotiť</button>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      </div>
      {items.length > 0 && (
        <ul className="upload-list">
          {items.map((i) => (
            <li key={i.key}>
              <span>{i.name}</span>
              <span className={`badge ${i.state}`}>
                {i.state === 'uploading' ? 'Nahrávam…' : i.state === 'extracting' ? 'Čítam údaje…' : i.state === 'done' ? 'Hotovo' : 'Chyba'}
              </span>
              {i.message && <div className="muted small">{i.message}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
