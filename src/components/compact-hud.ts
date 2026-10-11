// Persistent small HUD component (belowEditor widget).
import type { Component } from "@oh-my-pi/pi-tui";
import { compactIsAnimated, renderCompact } from "../render/compact.ts";
import { getLang } from "../i18n.ts";
import type { HudStore, HudTheme } from "../types.ts";

const FRAMES_PER_SEC = 12;

export class CompactHud implements Component {
  private readonly store: HudStore;
  private readonly theme: HudTheme;
  private cacheKey = "";
  private cacheLines: readonly string[] = [];

  constructor(store: HudStore, theme: HudTheme) {
    this.store = store;
    this.theme = theme;
  }

  render(width: number): readonly string[] {
    const state = this.store.state;
    // Without animation (idle, no running node) the phase bucket is constant: the same array reference is returned.
    const bucket = compactIsAnimated(state) ? Math.floor(Math.max(0, state.phase) * FRAMES_PER_SEC) : -1;
    const key = `${this.store.version}|${bucket}|${width}|${getLang()}`;
    if (key === this.cacheKey) return this.cacheLines;
    this.cacheLines = renderCompact(state, width, this.theme);
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
