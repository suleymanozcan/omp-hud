// Full-screen HUD component (omp Component): the /hud overlay. Besides the live panels it has a conversation panel and a prompt,
// so you can write to the agent and read the answers without leaving it.
import { matchesKey } from "@oh-my-pi/pi-tui";
import type { Component } from "@oh-my-pi/pi-tui";
import { newChatView, type ChatBridge, type SendMode } from "../chat.ts";
import { ct } from "../chat-i18n.ts";
import { composeHud, type ComposeOptions } from "../render/layout.ts";
import { getLang } from "../i18n.ts";
import { renderFullScene } from "../render/full-scene.ts";
import type { HudStore, HudTheme } from "../types.ts";
import { InputLine } from "./input-line.ts";

const DEFAULT_ROWS = 30;
const FRAMES_PER_SEC = 15; // phase bucket: the same bucket yields the same array reference
const HISTORY_MAX = 30;
const SAMPLE_MS = 1000;
const FLASH_MS = 4000;
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
  private flash: { text: string; level: "info" | "warning" | "error"; until: number } | undefined;
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
    if (this.flash && Date.now() >= this.flash.until) {
      this.flash = undefined;
      this.uiRev++;
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

    const opts: ComposeOptions = {
      selectedId: this.selectedId,
      detail: this.detail,
      orbit: renderFullScene,
      history: this.history,
      chatView: this.chatView,
      inputRow: this.input.render(width, this.theme, ct("chat.placeholder")),
      inputEmpty: this.input.isEmpty,
      ...(this.flash ? { flash: { text: this.flash.text, level: this.flash.level } } : {}),
    };
    this.cacheLines = composeHud(state, width, rows, this.theme, opts);
    this.cacheKey = key;
    return this.cacheLines;
  }

  handleInput(data: string): void {
    try {
      if (this.input.pasting || this.input.startsPaste(data)) {
        this.input.handleInput(data);
      } else if (matchesKey(data, "escape")) {
        if (this.detail) this.detail = false;
        else if (!this.input.isEmpty) this.input.clear();
        else {
          this.close();
          return;
        }
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

  /** Enter (`steer`) / Alt+Enter (`after`): an empty line toggles the node details; `/hud ...` runs here; other `/` lines are refused; the rest goes to the agent. */
  private submit(text: string, mode: SendMode): void {
    if (text === "") {
      if (this.selectedId !== undefined) this.detail = !this.detail;
      return;
    }
    if (text.startsWith("/")) {
      const m = /^\/hud(?:\s+(.*))?$/i.exec(text);
      if (m) this.bridge?.command((m[1] ?? "").trim());
      else {
        this.input.restore(text);
        this.flash = { text: ct("chat.noSlash"), level: "warning", until: Date.now() + FLASH_MS };
      }
      return;
    }
    this.chatView.follow = true;
    this.bridge?.send(text, mode);
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
