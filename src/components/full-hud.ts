// Full-screen HUD component (omp Component): the /hud overlay.
import { matchesKey } from "@oh-my-pi/pi-tui";
import type { Component } from "@oh-my-pi/pi-tui";
import { composeHud } from "../render/layout.ts";
import { getLang } from "../i18n.ts";
import { renderOrbitScene } from "../render/orbit-scene.ts";
import type { HudStore, HudTheme } from "../types.ts";

const DEFAULT_ROWS = 30;
const FRAMES_PER_SEC = 15; // phase bucket: the same bucket yields the same array reference
const HISTORY_MAX = 30;
const SAMPLE_MS = 1000;

export class FullHud implements Component {
  private readonly store: HudStore;
  private readonly theme: HudTheme;
  private readonly requestRender: () => void;
  private readonly close: () => void;
  private readonly getRows?: () => number;

  private selectedId: string | undefined;
  private detail = false;
  private readonly history: number[] = [];
  private lastSampleAt = -Infinity;
  private samples = 0;
  private cacheKey = "";
  private cacheLines: readonly string[] = [];
  private unsubscribe: (() => void) | undefined;

  constructor(store: HudStore, theme: HudTheme, requestRender: () => void, close: () => void, getRows?: () => number) {
    this.store = store;
    this.theme = theme;
    this.requestRender = requestRender;
    this.close = close;
    this.getRows = getRows;
    try {
      this.unsubscribe = store.subscribe(() => {
        try {
          this.requestRender();
        } catch {
          // a render request never throws
        }
      });
    } catch {
      this.unsubscribe = undefined;
    }
  }

  render(width: number): readonly string[] {
    const state = this.store.state;
    let rows = DEFAULT_ROWS;
    try {
      const r = this.getRows?.();
      if (typeof r === "number" && Number.isFinite(r) && r > 0) rows = Math.floor(r);
    } catch {
      rows = DEFAULT_ROWS;
    }

    // If the selected node disappeared, the selection is cleared.
    if (this.selectedId !== undefined && !state.nodes.some((n) => n.id === this.selectedId)) {
      this.selectedId = undefined;
      this.detail = false;
    }

    // tok/s sparkline history: one sample per ~1 s (as state.now advances).
    if (state.now - this.lastSampleAt >= SAMPLE_MS) {
      this.lastSampleAt = state.now;
      this.history.push(state.tokens.tokPerSec);
      if (this.history.length > HISTORY_MAX) this.history.shift();
      this.samples++;
    }

    const bucket = Math.floor(Math.max(0, state.phase) * FRAMES_PER_SEC);
    const key = `${this.store.version}|${bucket}|${width}|${rows}|${this.selectedId ?? ""}|${this.detail ? 1 : 0}|${this.samples}|${getLang()}`;
    if (key === this.cacheKey) return this.cacheLines;

    this.cacheLines = composeHud(state, width, rows, this.theme, {
      selectedId: this.selectedId,
      detail: this.detail,
      orbit: renderOrbitScene,
      history: this.history,
    });
    this.cacheKey = key;
    return this.cacheLines;
  }

  handleInput(data: string): void {
    try {
      if (matchesKey(data, "escape")) {
        if (this.detail) this.detail = false;
        else {
          this.close();
          return;
        }
      } else if (matchesKey(data, "q")) {
        this.close();
        return;
      } else if (matchesKey(data, "right") || matchesKey(data, "tab")) this.select(1);
      else if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) this.select(-1);
      else if (matchesKey(data, "enter")) {
        if (this.selectedId === undefined) return;
        this.detail = !this.detail;
      } else if (matchesKey(data, "c")) {
        if (this.selectedId === undefined) return;
        this.selectedId = undefined;
        this.detail = false;
      } else return;
      this.invalidate();
      this.requestRender();
    } catch {
      // the input handler never throws
    }
  }

  invalidate(): void {
    this.cacheKey = "";
  }

  dispose(): void {
    const off = this.unsubscribe;
    this.unsubscribe = undefined;
    if (off) {
      try {
        off();
      } catch {
        // idempotent
      }
    }
  }

  private select(dir: 1 | -1): void {
    const nodes = this.store.state.nodes;
    if (nodes.length === 0) return;
    const cur = this.selectedId === undefined ? -1 : nodes.findIndex((n) => n.id === this.selectedId);
    let next: number;
    if (cur < 0) next = dir === 1 ? 0 : nodes.length - 1;
    else next = (cur + dir + nodes.length) % nodes.length;
    this.selectedId = nodes[next]!.id;
  }
}
