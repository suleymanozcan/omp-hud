// Orbit scene: core + node orbit + labels + status row. Exactly `height` rows, every row exactly `width` cells.
// The width guarantee is structural: braille/label cells are single-cell; node names are reduced to single-cell characters.

import type { CoreStatus, HudState, HudTheme } from "../types";
import { type MsgKey, t } from "../i18n.ts";
import { BrailleCanvas, type Palette, paletteFor, shade } from "./canvas";
import { drawCore } from "./core";
import { CORE_RATIO, type NodePos, drawRing } from "./ring";

const MIN_COLS = 24;
const MIN_ROWS = 10;
const LABEL_MAX = 10;

const STATUS_KEY: Record<CoreStatus, MsgKey> = {
  idle: "status.idle",
  thinking: "status.thinking",
  streaming: "status.streaming",
  tool: "status.tool",
  error: "status.error",
  done: "status.done",
};
const WARNING_KEY: Record<NonNullable<HudState["core"]["warning"]>, MsgKey> = {
  retry: "warn.retry",
  compaction: "warn.compaction",
  fallback: "warn.fallback",
};

let canvas: BrailleCanvas | null = null;
let occ = new Uint8Array(0);
let blank = "";
let blankWidth = -1;

/** Single-cell width guarantee: anything outside Latin-1/Latin Extended-A becomes `?`; control characters are dropped. */
function cleanLabel(name: string): string {
  let out = "";
  for (let i = 0; i < name.length && out.length < LABEL_MAX; i++) {
    const code = name.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    out += code < 0x250 ? name[i] : "?";
  }
  return out;
}

function statusLine(state: HudState): string {
  if (state.core.status === "tool" && state.core.activeTool) return t("status.toolNamed", { name: cleanLabel(state.core.activeTool) });
  return t(STATUS_KEY[state.core.status] ?? "status.idle");
}

function blankLine(width: number): string {
  if (blankWidth !== width) {
    blank = " ".repeat(width);
    blankWidth = width;
  }
  return blank;
}

function tinyScene(state: HudState, width: number, height: number, theme: HudTheme): string[] {
  let running = 0;
  let failed = 0;
  for (const n of state.nodes) {
    if (n.status === "running") running++;
    else if (n.status === "failed") failed++;
  }
  let text = `${t("scene.mainAgent")} · ${statusLine(state)}`;
  if (state.nodes.length > 0) text += ` · ${running}/${state.nodes.length}`;
  if (failed > 0) text += ` · ${failed} ${t("node.failed")}`;
  if (text.length > width) text = text.slice(0, width);
  const token = state.core.status === "error" ? "error" : state.core.status === "done" ? "success" : "accent";
  const colored = theme.fg(token, text);
  const rows: string[] = [];
  const mid = Math.floor((height - 1) / 2);
  for (let r = 0; r < height; r++) {
    rows.push(r === mid ? colored + " ".repeat(width - text.length) : blankLine(width));
  }
  return rows;
}

function rectFree(col: number, row: number, len: number, cols: number, rows: number): boolean {
  if (row < 0 || row >= rows || col < 0 || col + len > cols) return false;
  // Keep labels from touching: at least 1 empty column on both sides (the canvas edge does not count).
  const from = Math.max(0, col - 1);
  const to = Math.min(cols, col + len + 1);
  const base = row * cols;
  for (let i = from; i < to; i++) if (occ[base + i] !== 0) return false;
  return true;
}

function placeLabel(c: BrailleCanvas, p: NodePos, cx: number, pal: Palette, selected: boolean): void {
  const label = cleanLabel(p.node.name);
  if (label.length === 0) return;
  const cols = c.cols;
  const rows = c.rows;
  const nodeCol = Math.floor(p.x / 2);
  const nodeRow = Math.floor(p.y / 4);
  const right = p.x >= cx;
  const len = label.length;
  const rightCol = nodeCol + 3;
  const leftCol = nodeCol - 2 - len;
  const prefCol = right ? rightCol : leftCol;
  const altCol = right ? leftCol : rightCol;
  // Prefer the outer side; then the opposite side; then the row above/below.
  let col = -1;
  let row = nodeRow;
  if (rectFree(prefCol, nodeRow, len, cols, rows)) col = prefCol;
  else if (rectFree(altCol, nodeRow, len, cols, rows)) col = altCol;
  else if (rectFree(prefCol, nodeRow + 1, len, cols, rows)) {
    col = prefCol;
    row = nodeRow + 1;
  } else if (rectFree(prefCol, nodeRow - 1, len, cols, rows)) {
    col = prefCol;
    row = nodeRow - 1;
  }
  if (col < 0) return;
  let hue: "accent" | "success" | "error" | "text" = "accent";
  let inten = 0.95;
  switch (p.node.status) {
    case "completed":
      hue = "success";
      inten = 0.6;
      break;
    case "failed":
      hue = "error";
      inten = 0.9;
      break;
    case "aborted":
      hue = "error";
      inten = 0.35;
      break;
    default:
  }
  if (selected) {
    hue = "text";
    inten = 1;
  }
  c.text(col, row, label, shade(pal, hue, inten));
  const base = row * cols + col;
  for (let i = 0; i < len; i++) occ[base + i] = 1;
}

/**
 * Exactly `height` rows, each with visible width == width (space padded). Below 24 columns / 10 rows it is a one-line summary.
 * A new array is returned on every call (the cell arrays are reused by the internal canvas).
 */
export function renderOrbitScene(state: HudState, width: number, height: number, theme: HudTheme, opts?: { selectedId?: string }): string[] {
  width = Math.floor(width);
  height = Math.floor(height);
  if (!(width > 0) || !(height > 0)) return [];
  if (width < MIN_COLS || height < MIN_ROWS) return tinyScene(state, width, height, theme);

  if (!canvas) canvas = new BrailleCanvas(width, height);
  else canvas.resize(width, height);
  const c = canvas;
  c.clear();
  if (occ.length < width * height) occ = new Uint8Array(width * height);
  else occ.fill(0, 0, width * height);

  const pal = paletteFor(theme);
  const pw = width * 2;
  const sceneRows = height - 1; // the last row is the status label
  const ph = sceneRows * 4;
  const cx = (pw - 1) / 2;
  const cy = (ph - 1) / 2;
  const labelRoom = Math.min(22, pw * 0.15);
  const radius = Math.min(ph / 2 - 3, pw / 2 - 2 - labelRoom);
  if (radius < 10) return tinyScene(state, width, height, theme);

  const pos = drawRing(c, state, cx, cy, radius, theme, opts?.selectedId);
  drawCore(c, state, cx, cy, radius * CORE_RATIO, theme);

  // Occupied cells: status row, core, node dots.
  occ.fill(1, sceneRows * width, height * width);
  const coreCols = Math.ceil((radius * CORE_RATIO * 1.2) / 2);
  const coreRows = Math.ceil((radius * CORE_RATIO * 1.2) / 4);
  const ccol = Math.floor(cx / 2);
  const crow = Math.floor(cy / 4);
  for (let r = crow - coreRows; r <= crow + coreRows; r++) {
    for (let col = ccol - coreCols; col <= ccol + coreCols; col++) {
      if (r >= 0 && r < height && col >= 0 && col < width) occ[r * width + col] = 1;
    }
  }
  for (const p of pos) {
    const r = Math.floor(p.y / 4);
    const col = Math.floor(p.x / 2);
    for (let d = -1; d <= 1; d++) {
      const cc = col + d;
      if (r >= 0 && r < height && cc >= 0 && cc < width) occ[r * width + cc] = 1;
    }
  }
  const sel = opts?.selectedId;
  // Running nodes first, then the others.
  for (const p of pos) if (p.node.status === "running") placeLabel(c, p, cx, pal, sel === p.node.id);
  for (const p of pos) if (p.node.status !== "running") placeLabel(c, p, cx, pal, sel === p.node.id);

  const hidden = state.nodes.length - pos.length;
  if (hidden > 0) {
    const s = `+${hidden}`;
    c.text(Math.max(0, width - s.length), 0, s, shade(pal, "muted", 0.9));
  }

  // Status label (below the core, centered)
  const prefix = `${t("scene.mainAgent")} · `;
  const status = statusLine(state);
  const warn = state.core.warning ? ` · ${t(WARNING_KEY[state.core.warning])}` : "";
  let usePrefix = true;
  if (prefix.length + status.length + warn.length > width) usePrefix = false;
  const full = (usePrefix ? prefix : "") + status + warn;
  const shown = full.length > width ? full.slice(0, width) : full;
  let col = Math.floor((width - shown.length) / 2);
  const hue = state.core.status === "error" ? "error" : state.core.status === "done" ? "success" : "accent";
  const row = height - 1;
  let rest = shown;
  if (usePrefix) {
    const part = rest.slice(0, prefix.length);
    c.text(col, row, part, shade(pal, "muted", 0.8));
    col += part.length;
    rest = rest.slice(part.length);
  }
  const statusPart = rest.slice(0, status.length);
  c.text(col, row, statusPart, shade(pal, hue, 1));
  if (rest.length > statusPart.length) {
    c.text(col + statusPart.length, row, rest.slice(statusPart.length), shade(pal, "warning", 0.95));
  }

  return c.toRows(theme).slice();
}
