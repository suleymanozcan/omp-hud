// Thin ANSI-aware wrappers over the pi-tui text helpers.
import { truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";

/** Visible cell width (ANSI-free). */
export function vw(s: string): number {
  return visibleWidth(s);
}

/** Truncates to at most w visible cells (ANSI is preserved, "…" is appended). */
export function trunc(s: string, w: number): string {
  if (w <= 0) return "";
  if (visibleWidth(s) <= w) return s;
  return truncateToWidth(s, w, "…");
}

/** Pads on the right; truncates when longer than w. The result is exactly w cells. */
export function padEnd(s: string, w: number): string {
  if (w <= 0) return "";
  const t = trunc(s, w);
  const gap = w - visibleWidth(t);
  return gap > 0 ? t + " ".repeat(gap) : t;
}

/** Pads on the left; truncates when longer than w. The result is exactly w cells. */
export function padStart(s: string, w: number): string {
  if (w <= 0) return "";
  const t = trunc(s, w);
  const gap = w - visibleWidth(t);
  return gap > 0 ? " ".repeat(gap) + t : t;
}

/** Centers; truncates when longer than w. The result is exactly w cells. */
export function center(s: string, w: number): string {
  if (w <= 0) return "";
  const t = trunc(s, w);
  const gap = w - visibleWidth(t);
  if (gap <= 0) return t;
  const left = Math.floor(gap / 2);
  return " ".repeat(left) + t + " ".repeat(gap - left);
}
