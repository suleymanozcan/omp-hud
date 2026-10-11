// Dock widget (aboveEditor): the HUD as a short panel next to the prompt. Render only; the host drives the animation timer.
import type { Component } from "@oh-my-pi/pi-tui";
import { getLang } from "../i18n.ts";
import { DOCK_MAX_HEIGHT, DOCK_MIN_HEIGHT, dockFps, dockIsAnimated, renderDock } from "../render/dock.ts";
import type { HudStore, HudTheme } from "../types.ts";

export type DockSize = "small" | "medium" | "large";

const BASE_HEIGHT: Readonly<Record<DockSize, number>> = { small: 8, medium: 12, large: 16 };
/** Dock rows on short terminals (below 20 rows): 4-6 depending on the size. */
const SHORT_HEIGHT: Readonly<Record<DockSize, number>> = { small: 4, medium: 5, large: 6 };
/** Below this terminal height the dock shrinks to 4-6 rows. */
const MIN_ROWS_FOR_DOCK = 20;
/** The dock never takes more than this share of the terminal rows. */
const MAX_ROW_SHARE = 0.45;

/** small 8, medium 12, large 16; at most 45% of `rows`; at least 4; 4-6 when rows < 20. */
export function dockHeightFor(size: DockSize, rows: number): number {
  if (!(rows >= 0)) return DOCK_MIN_HEIGHT;
  const cap = Math.max(DOCK_MIN_HEIGHT, Math.floor(rows * MAX_ROW_SHARE));
  if (rows < MIN_ROWS_FOR_DOCK) return Math.min(SHORT_HEIGHT[size] ?? SHORT_HEIGHT.medium, cap);
  const wanted = BASE_HEIGHT[size] ?? BASE_HEIGHT.large;
  return Math.min(DOCK_MAX_HEIGHT, Math.max(DOCK_MIN_HEIGHT, Math.min(wanted, cap)));
}

export class DockHud implements Component {
  private readonly store: HudStore;
  private readonly theme: HudTheme;
  private readonly getSize: () => DockSize;
  private readonly getRows: () => number;
  private cacheKey = "";
  private cacheLines: readonly string[] = [];

  constructor(store: HudStore, theme: HudTheme, opts: { getSize: () => DockSize; getRows: () => number }) {
    this.store = store;
    this.theme = theme;
    this.getSize = opts.getSize;
    this.getRows = opts.getRows;
  }

  render(width: number): readonly string[] {
    const state = this.store.state;
    const height = dockHeightFor(this.getSize(), this.getRows());
    // Without animation (a finished turn, nothing running, no recent event) the phase bucket is constant: the same array reference is returned.
    const bucket = dockIsAnimated(state) ? Math.floor(Math.max(0, state.phase) * dockFps(state)) : -1;
    const key = `${this.store.version}|${bucket}|${width}|${height}|${getLang()}`;
    if (key === this.cacheKey) return this.cacheLines;
    this.cacheLines = renderDock(state, width, height, this.theme);
    this.cacheKey = key;
    return this.cacheLines;
  }

  invalidate(): void {
    this.cacheKey = "";
  }

  dispose(): void {
    // no subscription
  }
}
