/** Bezpečný návrat po prihlásení/odhlásení: len relatívna cesta v appke (nie `//host` ani `/\host`). */
export function safeNext(next: string | null | undefined): string | null {
  return next && /^\/(?![/\\])/.test(next) ? next : null;
}
