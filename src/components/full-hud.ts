// Full-screen HUD component (omp Component): the /hud overlay. Besides the live panels it has a conversation panel and a prompt,
// so you can write to the agent and read the answers without leaving it.
import { matchesKey } from "@oh-my-pi/pi-tui";
import type { Component } from "@oh-my-pi/pi-tui";
import { newChatView, type ChatBridge, type SendMode, type Suggestion } from "../chat.ts";
import { ct } from "../chat-i18n.ts";
import { composeHud, type ComposeOptions } from "../render/layout.ts";
import { getLang } from "../i18n.ts";
import { PALETTE_ROWS, paletteTop, renderPalette } from "../render/palette.ts";
import { renderFullScene } from "../render/full-scene.ts";
import { lineKind, wantsPalette } from "../slash.ts";
import type { HudStore, HudTheme } from "../types.ts";
import { InputLine } from "./input-line.ts";

/** The command palette: the items for `text` with the cursor at `caret`, the selected item and the first visible one. */
interface Palette {
  items: Suggestion[];
  prefix: string;
  text: string;
  caret: number;
  sel: number;
  top: number;
}

const DEFAULT_ROWS = 30;
const FRAMES_PER_SEC = 15; // phase bucket: the same bucket yields the same array reference
const HISTORY_MAX = 30;
const SAMPLE_MS = 1000;
const WHEEL_LINES = 3; // Ctrl+Up / Ctrl+Down

export class FullHud implements Component {
  private readonly store: HudStore;
  private readonly theme: HudTheme;
  private readonly requestRender: () => void;
  private readonly close: () => void;
  private readonly getRows?: () => number;
  private readonly bridge?: ChatBridge;

  private selectedId: string | undefined;
  private detail = false;
  private readonly input = new InputLine();
  private readonly chatView = newChatView();
  private palette: Palette | undefined; // omp's completion items for the current prompt text
  private paletteSeq = 0; // answers of older queries are dropped
  private paletteAbort: AbortController | undefined;
  private paletteOffFor: string | undefined; // the prompt text for which Esc closed the list
  private uiRev = 0; // bumped by everything that changes the picture without touching the store
  private readonly history: number[] = [];
  private lastSampleAt = -Infinity;
  private samples = 0;
  private cacheKey = "";
  private cacheLines: readonly string[] = [];
  private unsubscribe: (() => void) | undefined;

  constructor(
    store: HudStore,
    theme: HudTheme,
    requestRender: () => void,
    close: () => void,
    getRows?: () => number,
    bridge?: ChatBridge,
  ) {
    this.store = store;
    this.theme = theme;
    this.requestRender = requestRender;
    this.close = close;
    this.getRows = getRows;
    this.bridge = bridge;
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
    const key = [
      this.store.version,
      bucket,
      width,
      rows,
      this.selectedId ?? "",
      this.detail ? 1 : 0,
      this.samples,
      getLang(),
      state.chatRev ?? 0,
      this.uiRev,
    ].join("|");
    if (key === this.cacheKey) return this.cacheLines;

    const pal = this.palette;
    const palRows = pal ? Math.min(PALETTE_ROWS, pal.items.length, Math.max(1, rows - 6)) : 0;
    if (pal) pal.top = paletteTop(pal.top, pal.sel, palRows, pal.items.length);
    const kind = lineKind(this.input.text);
    const opts: ComposeOptions = {
      selectedId: this.selectedId,
      detail: this.detail,
      orbit: renderFullScene,
      history: this.history,
      chatView: this.chatView,
      inputRow: this.input.render(width, this.theme, ct("chat.placeholder")),
      inputEmpty: this.input.isEmpty,
      command: kind !== "text" && kind !== "hud",
      ...(pal ? { palette: renderPalette(pal.items, pal.sel, pal.top, palRows, width, this.theme) } : {}),
    };
    this.cacheLines = composeHud(state, width, rows, this.theme, opts);
    this.cacheKey = key;
    return this.cacheLines;
  }

  handleInput(data: string): void {
    try {
      if (this.input.pasting || this.input.startsPaste(data)) {
        this.input.handleInput(data);
        this.refreshPalette();
      } else if (matchesKey(data, "escape")) {
        if (this.palette) {
          this.paletteOffFor = this.input.text;
          this.closePalette();
        } else if (this.detail) this.detail = false;
        else if (!this.input.isEmpty) this.input.clear();
        else {
          this.close();
          return;
        }
      } else if (this.paletteKey(data)) {
        // the list took the key
      } else if (matchesKey(data, "tab")) this.select(1);
      else if (matchesKey(data, "shift+tab")) this.select(-1);
      else if (matchesKey(data, "pageUp")) this.scroll(this.chatView.page - 1);
      else if (matchesKey(data, "pageDown")) this.scroll(-(this.chatView.page - 1));
      else if (matchesKey(data, "ctrl+up")) this.scroll(WHEEL_LINES);
      else if (matchesKey(data, "ctrl+down")) this.scroll(-WHEEL_LINES);
      else if (matchesKey(data, "ctrl+end") || (matchesKey(data, "end") && this.input.isEmpty)) this.follow();
      else {
        const res = this.input.handleInput(data);
        if (res.kind === "none") return;
        if (res.kind === "submit") this.submit(res.text, res.mode);
        else this.refreshPalette();
      }
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
    this.closePalette();
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

  /** Enter (`steer`) / Alt+Enter (`after`): an empty line toggles the node details; `/hud ...` runs here; `/command`, `!shell` and `$ python` lines are run by omp through its editor; the rest goes to the agent. */
  private submit(text: string, mode: SendMode): void {
    if (text === "") {
      if (this.selectedId !== undefined) this.detail = !this.detail;
      return;
    }
    this.closePalette();
    const kind = lineKind(text);
    if (kind === "hud") {
      const m = /^\/hud(?:\s+(.*))?$/i.exec(text);
      this.bridge?.command((m?.[1] ?? "").trim());
      return;
    }
    this.chatView.follow = true;
    if (kind === "text") this.bridge?.send(text, mode);
    else this.runLine(text);
  }

  /** A line for omp itself. The bridge hides this HUD while the command runs; a refused line (unknown command, no editor) is put back into the prompt. */
  private runLine(text: string): void {
    const bridge = this.bridge;
    if (!bridge) return;
    const back = (): void => {
      if (this.input.isEmpty) this.input.restore(text);
    };
    bridge.runLine(text).then(
      (outcome) => {
        if (outcome === "refused") back();
      },
      back,
    ).finally(() => {
      this.invalidate();
      try {
        this.requestRender();
      } catch {
        // a render request never throws
      }
    });
  }

  // --- command palette ---

  /** The palette belongs to the text and cursor as they are now (a query that was answered late does not count). */
  private livePalette(): Palette | undefined {
    const p = this.palette;
    return p && p.text === this.input.text && p.caret === this.input.caret ? p : undefined;
  }

  private closePalette(): void {
    this.paletteSeq++;
    this.paletteAbort?.abort();
    this.paletteAbort = undefined;
    this.palette = undefined;
  }

  /** Asks omp's autocomplete provider about the prompt (one query per edit; an older answer never overwrites a newer one). */
  private refreshPalette(): void {
    const bridge = this.bridge;
    const text = this.input.text;
    const caret = this.input.caret;
    if (this.paletteOffFor !== undefined && this.paletteOffFor !== text) this.paletteOffFor = undefined;
    if (!bridge || text === "" || this.paletteOffFor === text || !wantsPalette(text, caret)) {
      this.closePalette();
      return;
    }
    this.paletteAbort?.abort();
    const ac = new AbortController();
    this.paletteAbort = ac;
    const seq = ++this.paletteSeq;
    bridge.suggest(text, caret, ac.signal).then(
      (res) => {
        if (seq !== this.paletteSeq) return;
        this.palette = res ? { items: res.items, prefix: res.prefix, text, caret, sel: 0, top: 0 } : undefined;
        this.invalidate();
        this.requestRender();
      },
      () => {
        if (seq === this.paletteSeq) this.palette = undefined;
      },
    );
  }

  /** ↑/↓ move, Tab applies, Enter applies (unless the text already is what applying would give: then Enter runs it). True when the key was used. */
  private paletteKey(data: string): boolean {
    const p = this.livePalette();
    if (!p) return false;
    const n = p.items.length;
    if (matchesKey(data, "up")) p.sel = (p.sel - 1 + n) % n;
    else if (matchesKey(data, "down")) p.sel = (p.sel + 1) % n;
    else if (matchesKey(data, "tab") || matchesKey(data, "enter")) {
      const done = this.bridge?.apply(p.text, p.caret, p.items[p.sel]!, p.prefix);
      if (matchesKey(data, "enter") && (!done || done.text.trim() === p.text.trim())) return false;
      if (done) {
        this.input.setAt(done.text, done.cursor);
        this.refreshPalette();
      }
    } else return false;
    return true;
  }

  private scroll(lines: number): void {
    const v = this.chatView;
    if (v.max <= 0 && lines > 0) return;
    if (lines > 0) {
      v.follow = false;
      v.offset = Math.min(v.max, v.offset + lines);
    } else {
      v.offset = Math.max(0, v.offset + lines);
      if (v.offset === 0) v.follow = true;
    }
  }

  private follow(): void {
    this.chatView.follow = true;
    this.chatView.offset = 0;
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
