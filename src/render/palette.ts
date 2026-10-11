// Command palette rows of the full-screen prompt: name, argument hint and description of omp's completion items.
import type { Suggestion } from "../chat.ts";
import type { HudTheme } from "../types.ts";
import { padEnd, trunc, vw } from "../util/text.ts";

export const PALETTE_ROWS = 8; // list rows at most
const NAME_MAX = 28;

/** First visible item so that the selection stays inside a window of `rows` items. */
export function paletteTop(top: number, selected: number, rows: number, total: number): number {
  let t = top;
  if (selected < t) t = selected;
  else if (selected >= t + rows) t = selected - rows + 1;
  return Math.max(0, Math.min(t, Math.max(0, total - rows)));
}

/** Exactly `min(rows, items left)` rows of exactly `width` cells; the selected one is reversed. */
export function renderPalette(items: readonly Suggestion[], selected: number, top: number, rows: number, width: number, theme: HudTheme, slashNames = false): string[] {
  const shown = items.slice(top, top + rows);
  // omp's command items carry bare names (`tools`): the list shows them the way they are typed.
  const label = (s: Suggestion): string => (slashNames && !s.label.startsWith("/") ? `/${s.label}` : s.label);
  const widest = Math.max(1, ...shown.map((s) => vw(label(s))));
  const nameW = Math.min(widest, NAME_MAX, Math.max(8, Math.floor((width - 4) * 0.4)));
  return shown.map((s, i) => {
    const on = top + i === selected;
    const name = padEnd(label(s), nameW);
    const hint = s.argumentHint ? ` ${s.argumentHint}` : "";
    const rest = Math.max(0, width - 2 - nameW - 1);
    const desc = s.description ? s.description.replace(/\s+/g, " ") : "";
    const tail = trunc(`${hint}${hint && desc ? "  " : ""}${desc}`, rest);
    if (on) return `\x1b[7m${padEnd(` ▸ ${name} ${tail}`, width)}\x1b[27m`;
    const split = Math.min(hint.length, tail.length);
    const styledTail = theme.fg("muted", tail.slice(0, split)) + theme.fg("dim", tail.slice(split));
    return padEnd(`   ${theme.fg("accent", name)} ${styledTail}`, width);
  });
}
