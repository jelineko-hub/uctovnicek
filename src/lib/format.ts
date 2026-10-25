const eur = new Intl.NumberFormat('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** `numeric` z PostgREST chodí ako string → vždy cez Number(). */
export function money(v: number | string | null | undefined, currency = 'EUR'): string {
  if (v === null || v === undefined || v === '') return '—';
  return `${eur.format(Number(v))} ${currency === 'EUR' ? '€' : currency}`;
}

export function date(v: string | null | undefined): string {
  if (!v) return '—';
  const [y, m, d] = v.slice(0, 10).split('-');
  return `${Number(d)}. ${Number(m)}. ${y}`;
}
