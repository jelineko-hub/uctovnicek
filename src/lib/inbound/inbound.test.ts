import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { attachmentMime, inboxSlugsFor, makeSlug, parseAddress, parseSenders, pickAttachments, senderAllowed } from './mail';
import { verifyWebhook } from './resend';

describe('parseAddress', () => {
  it('vytiahne e-mail z mena a zátvoriek', () => {
    expect(parseAddress('Ján Novák <Jan.Novak@Firma.SK>')).toBe('jan.novak@firma.sk');
    expect(parseAddress(' faktury@orange.sk ')).toBe('faktury@orange.sk');
    expect(parseAddress('bez adresy')).toBeNull();
    expect(parseAddress(null)).toBeNull();
  });
});

describe('inboxSlugsFor', () => {
  it('berie len adresy našej domény', () => {
    expect(
      inboxSlugsFor(['Topclima <topclima-ab3cd@in.uctovnicek.sk>', 'iny@gmail.com', 'TOPCLIMA-AB3CD@IN.UCTOVNICEK.SK'], 'in.uctovnicek.sk'),
    ).toEqual(['topclima-ab3cd']);
    expect(inboxSlugsFor(['x@uctovnicek.sk'], 'in.uctovnicek.sk')).toEqual([]);
  });
});

describe('makeSlug', () => {
  it('názov bez diakritiky + náhodná prípona', () => {
    const slug = makeSlug('TopClima s.r.o. — Žilina', () => 0);
    expect(slug).toBe('topclima-s-r-o-zilina-aaaaa');
    expect(slug).toMatch(/^[a-z0-9][a-z0-9-]{2,40}$/);
  });
  it('krátky alebo prázdny názov', () => {
    expect(makeSlug('', () => 0)).toBe('firma-aaaaa');
    expect(makeSlug('AB', () => 0)).toMatch(/^firma-ab-aaaaa$/);
  });
  it('dlhý názov sa skráti', () => {
    expect(makeSlug('a'.repeat(100), () => 0).length).toBeLessThanOrEqual(41);
  });
});

describe('povolení odosielatelia', () => {
  it('parseSenders: e-maily, domény, chyby', () => {
    expect(parseSenders('jan@firma.sk\n@Orange.sk, zle\n\njan@firma.sk')).toEqual({
      senders: ['jan@firma.sk', '@orange.sk'],
      invalid: ['zle'],
    });
  });
  it('senderAllowed: presná adresa, doména, allow_all', () => {
    const inbox = { allow_all: false, allowed_senders: ['jan@firma.sk', '@orange.sk'] };
    expect(senderAllowed('Ján <JAN@firma.sk>', inbox)).toBe(true);
    expect(senderAllowed('faktury@orange.sk', inbox)).toBe(true);
    expect(senderAllowed('faktury@sub.orange.sk', inbox)).toBe(false);
    expect(senderAllowed('cudzi@spam.com', inbox)).toBe(false);
    expect(senderAllowed('cudzi@spam.com', { ...inbox, allow_all: true })).toBe(true);
  });
});

describe('prílohy', () => {
  it('typ podľa content-type alebo prípony', () => {
    expect(attachmentMime({ id: '1', filename: 'FA.PDF', content_type: 'application/octet-stream' })).toBe('application/pdf');
    expect(attachmentMime({ id: '1', filename: 'x', content_type: 'image/jpeg; name=x.jpg' })).toBe('image/jpeg');
    expect(attachmentMime({ id: '1', filename: 'faktura.xml', content_type: 'text/xml' })).toBeNull();
  });
  it('vynechá logá v podpise a nepodporované typy', () => {
    const { use, skipped } = pickAttachments([
      { id: '1', filename: 'faktura.pdf', content_type: 'application/pdf', content_disposition: 'attachment', size: 80_000 },
      { id: '2', filename: 'logo.png', content_type: 'image/png', content_disposition: 'inline', size: 4_000 },
      { id: '3', filename: 'blocek.jpg', content_type: 'image/jpeg', content_disposition: 'inline', size: 900_000 },
      { id: '4', filename: 'faktura.xml', content_type: 'application/xml', content_disposition: 'attachment', size: 5_000 },
      { id: '5', filename: 'velka.pdf', content_type: 'application/pdf', content_disposition: 'attachment', size: 30_000_000 },
    ]);
    expect(use.map((a) => a.id)).toEqual(['1', '3']);
    expect(skipped).toEqual(['faktura.xml: nepodporovaný typ', 'velka.pdf: väčšia ako 20 MB']);
  });
});

describe('verifyWebhook (Svix)', () => {
  const key = Buffer.from('test-secret-key-0123456789');
  const secret = `whsec_${key.toString('base64')}`;
  const body = '{"type":"email.received","data":{"email_id":"abc"}}';
  const now = 1_800_000_000;
  const sign = (id: string, ts: number, b: string) =>
    createHmac('sha256', key).update(`${id}.${ts}.${b}`).digest('base64');

  it('platný podpis (aj medzi viacerými)', () => {
    const sig = sign('msg_1', now, body);
    expect(verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(true);
    expect(verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature: `v1,AAAA v1,${sig}` }, body, now)).toBe(true);
  });
  it('zmenené telo, starý čas, chýbajúce hlavičky', () => {
    const sig = sign('msg_1', now, body);
    expect(verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` }, body + ' ', now)).toBe(false);
    expect(verifyWebhook(secret, { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` }, body, now + 3600)).toBe(false);
    expect(verifyWebhook(secret, { id: null, timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(false);
    expect(verifyWebhook('', { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` }, body, now)).toBe(false);
  });
});
