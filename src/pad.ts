// Bottom padding: some terminal windows hide the last row(s) of the screen. The compact widget gets N blank
// rows below its content and the full-screen HUD is N rows shorter, so the last content row stays visible.
// Initial value: OMP_HUD_PAD (0-3, default 1); `/hud pad` overrides it at runtime (not persisted).

export const PAD_MIN = 0;
export const PAD_MAX = 3;
export const PAD_DEFAULT = 1;

/** Parses a pad value; undefined when it is not an integer in 0..3. */
export function parsePad(v: string | undefined): number | undefined {
  if (v === undefined || !/^\d$/.test(v.trim())) return undefined;
  const n = Number(v.trim());
  return n >= PAD_MIN && n <= PAD_MAX ? n : undefined;
}

let current: number | undefined;

export function getPad(): number {
  current ??= parsePad(process.env.OMP_HUD_PAD) ?? PAD_DEFAULT;
  return current;
}

export function setPad(n: number): void {
  current = Math.min(PAD_MAX, Math.max(PAD_MIN, Math.floor(n)));
}

/** Content lines followed by `pad` blank lines; the input array is returned as-is when pad is 0. */
export function withPad(lines: readonly string[], pad: number): readonly string[] {
  return pad > 0 ? [...lines, ...new Array<string>(pad).fill("")] : lines;
}
