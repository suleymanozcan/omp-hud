// Dock widget (aboveEditor): the HUD as a short panel next to the prompt. Render only; the host drives the animation timer.
import type { Component } from "@oh-my-pi/pi-tui";
import { getLang } from "../i18n.ts";
import { DOCK_MAX_HEIGHT, DOCK_MIN_HEIGHT, dockIsAnimated, renderDock } from "../render/dock.ts";
import type { HudStore, HudTheme } from "../types.ts";

export type DockSize = "small" | "medium" | "large";

const FRAMES_PER_SEC = 8;
const BASE_HEIGHT: Readonly<Record<DockSize, number>> = { small: 6, medium: 9, large: 12 };
/** Below this terminal height the dock shrinks to its minimum. */
const MIN_ROWS_FOR_DOCK = 20;
/** The dock never takes more than this share of the terminal rows. */
const MAX_ROW_SHARE = 0.4;

/** small 6, medium 9, large 12; at most 40% of `rows`; at least 4 (also when rows < 20). */
export function dockHeightFor(size: DockSize, rows: number): number {
  if (!(rows >= MIN_ROWS_FOR_DOCK)) return DOCK_MIN_HEIGHT;
  const wanted = BASE_HEIGHT[size] ?? BASE_HEIGHT.medium;
  return Math.min(DOCK_MAX_HEIGHT, Math.max(DOCK_MIN_HEIGHT, Math.min(wanted, Math.floor(rows * MAX_ROW_SHARE))));
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
    // Without animation (idle, nothing running, no recent event) the phase bucket is constant: the same array reference is returned.
    const bucket = dockIsAnimated(state) ? Math.floor(Math.max(0, state.phase) * FRAMES_PER_SEC) : -1;
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
