// Vyhľadávanie bez ohľadu na diakritiku: lowercase + NFD rozklad + zahodenie
// kombinujúcich znamienok („zilina" nájde „Žilina"). Dopyt najprv `.trim()`.

const COMBINING = /[̀-ͯ]/g;

/** Lowercase + odstránenie diakritiky. `null`/`undefined` → prázdny reťazec. */
export function fold(s: string | null | undefined): string {
  return (s || '').toLowerCase().normalize('NFD').replace(COMBINING, '');
}

/**
 * Vyhovuje niektoré z polí dopytu? `needle` MUSÍ byť už prejdené cez `fold()`
 * (volajúci ho spraví raz pre celý zoznam, nie per riadok).
 */
export function foldedIncludes(needle: string, ...fields: (string | null | undefined)[]): boolean {
  if (!needle) return true;
  return fields.some(f => fold(f).includes(needle));
}
