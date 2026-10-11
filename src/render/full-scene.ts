// Full-screen orbit scene: a big core, four elliptic rings that fill the whole area, node dots with readable labels
// (status icon + agent name, and a second line with the current tool / duration when there is room).
// Exactly `height` rows, every row exactly `width` cells. The width guarantee is structural: braille cells and labels are
// single-cell; names are reduced to single-cell characters. Own canvas, so the dock scene is never disturbed.

import type { HudNode, HudState, HudTheme } from "../types";
import { t } from "../i18n.ts";
import { BrailleCanvas, type Palette, paletteFor, shade } from "./canvas";
import { drawCore } from "./core";
import { fmtDur, taskSpinner } from "./fmt.ts";
import { renderOrbitScene } from "./orbit-scene.ts";
import { BIG_RINGS, CLASSIC_RINGS, type NodePos, type RingSpec, drawRing } from "./ring";
import { cleanLabel, statusLine, warningSuffix } from "./scene-text.ts";

const MIN_COLS = 16; // below this (or MIN_ROWS) the dock scene is used
const MIN_ROWS = 5;
const MIN_RADIUS = 6;
const STATUS_ROW_MIN = 10; // the status caption row needs this many rows
const COUNTS_ROW_MIN = 12;
const LABEL_MIN_COLS = 30;
const TWO_LINE_MIN_RY = 24; // sub-pixels
const BIG_MIN_RY = 30; // four rings only when there is room for them
const MAX_ASPECT = 3; // x radius / y radius: flatter areas keep a rounder scene and leave the sides to the labels
const NAME_MAX = 14;
const SHORT_NAME = 8;
const TOOL_MAX = 9;
const NODE_R = 4.6; // node glyph radius in sub-pixels at scale 1 (running pulse peak)
const CORE_EASE_MS = 400;

let canvas: BrailleCanvas | null = null;
let occ = new Uint8Array(0);
let coreScale = 1;
let coreScaleAt = -1;

/** Moves the core scale toward `target` over ~400 ms of state time (the first call snaps). */
function easeCoreScale(target: number, now: number): number {
  const dt = coreScaleAt < 0 ? Number.POSITIVE_INFINITY : Math.max(0, now - coreScaleAt);
  coreScaleAt = now;
  const step = (dt / CORE_EASE_MS) * 0.5;
  coreScale = coreScale < target ? Math.min(target, coreScale + step) : Math.max(target, coreScale - step);
  return coreScale;
}

/** Rows a node glyph of scale `s` covers on each side of its center row. */
function dotRows(s: number): number {
  return Math.max(1, Math.round((NODE_R * s) / 4));
}

function fitName(name: string, max: number): string {
  const s = cleanLabel(name, max + 1);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

interface Look {
  icon: string;
  hue: "accent" | "success" | "error" | "warning" | "text";
  inten: number;
}

function lookOf(node: HudNode, phase: number, selected: boolean): Look {
  let look: Look;
  switch (node.status) {
    case "completed":
      look = { icon: "✓", hue: "success", inten: 0.75 };
      break;
    case "failed":
      look = { icon: "✗", hue: "error", inten: 0.95 };
      break;
    case "aborted":
      look = { icon: "○", hue: "error", inten: 0.5 };
      break;
    default:
      look = node.retrying ? { icon: "↻", hue: "warning", inten: 0.95 } : { icon: taskSpinner(phase), hue: "accent", inten: 0.95 };
  }
  if (selected) look = { icon: look.icon, hue: "text", inten: 1 };
  return look;
}

function rectFree(col: number, row: number, w: number, h: number, cols: number, rows: number): boolean {
  if (row < 0 || row + h > rows || col < 0 || col + w > cols) return false;
  for (let r = row; r < row + h; r++) {
    const base = r * cols;
    for (let i = col; i < col + w; i++) if (occ[base + i] !== 0) return false;
  }
  return true;
}

function markRect(col: number, row: number, w: number, h: number, cols: number, rows: number): void {
  const c0 = Math.max(0, col);
  const c1 = Math.min(cols, col + w);
  for (let r = Math.max(0, row); r < Math.min(rows, row + h); r++) {
    for (let i = c0; i < c1; i++) occ[r * cols + i] = 1;
  }
}

/** Second label line: the running node's tool and its duration; the duration alone otherwise. */
function detailLine(node: HudNode, now: number): string {
  const dur = fmtDur((node.endedAt ?? now) - node.startedAt);
  if (node.status === "running" && node.currentTool) return `${cleanLabel(node.currentTool, TOOL_MAX)} ${dur}`;
  return dur;
}

interface Candidate {
  col: number;
  row: number;
  side: -1 | 0 | 1; // which side of the node the block is on (marker direction)
}

/** Tries the label of one node at several places around it; returns true when it was drawn. */
function placeLabel(
  c: BrailleCanvas,
  pal: Palette,
  p: NodePos,
  cx: number,
  s: number,
  now: number,
  phase: number,
  selected: boolean,
  allowTwoLines: boolean,
): boolean {
  const cols = c.cols;
  const rows = c.rows;
  const nodeCol = Math.floor(p.x / 2);
  const nodeRow = Math.floor(p.y / 4);
  const halfW = Math.ceil((NODE_R * s) / 2);
  const halfH = dotRows(s);
  const right = p.x >= cx;
  const look = lookOf(p.node, phase, selected);
  const variants: { name: string; two: boolean }[] = [];
  const full = fitName(p.node.name, NAME_MAX);
  if (allowTwoLines) variants.push({ name: full, two: true });
  variants.push({ name: full, two: false });
  if (full.length > SHORT_NAME) variants.push({ name: fitName(p.node.name, SHORT_NAME), two: false });
  const detail = allowTwoLines ? detailLine(p.node, now) : "";

  for (const v of variants) {
    // Line 1: icon + name (arrows on both ends when selected); line 2 (optional): tool / duration under the name.
    const line1 = `${selected ? "▸ " : ""}${look.icon} ${v.name}${selected ? " ◂" : ""}`;
    const line2 = v.two ? `${selected ? "  " : ""}  ${detail}` : "";
    const inner = Math.max(line1.length, line2.length);
    const w = inner + 2; // one blank column on each side
    const h = v.two ? 2 : 1;
    const side = (dir: 1 | -1): number => (dir === 1 ? nodeCol + halfW + 1 : nodeCol - halfW - w);
    const pref: 1 | -1 = right ? 1 : -1;
    const alt: 1 | -1 = right ? -1 : 1;
    const cand: Candidate[] = [
      { col: side(pref), row: nodeRow, side: pref },
      { col: side(alt), row: nodeRow, side: alt },
      { col: side(pref), row: nodeRow - 1, side: pref },
      { col: side(pref), row: nodeRow + 1, side: pref },
      { col: side(alt), row: nodeRow - 1, side: alt },
      { col: side(alt), row: nodeRow + 1, side: alt },
      { col: nodeCol - Math.floor(w / 2), row: nodeRow + halfH + 1, side: 0 },
      { col: nodeCol - Math.floor(w / 2), row: nodeRow - halfH - h, side: 0 },
    ];
    for (const k of cand) {
      if (!rectFree(k.col, k.row, w, h, cols, rows)) continue;
      const blank = " ".repeat(w);
      // Labels left of the node are right-aligned so the text stays next to it.
      const at = (len: number): number => k.col + (k.side === -1 ? w - 1 - len : 1);
      c.text(k.col, k.row, blank, 0);
      c.text(at(line1.length), k.row, line1, shade(pal, look.hue, look.inten));
      if (v.two) {
        c.text(k.col, k.row + 1, blank, 0);
        c.text(at(line2.length), k.row + 1, line2, shade(pal, selected ? "text" : "muted", selected ? 0.8 : 0.75));
      }
      markRect(k.col, k.row, w, h, cols, rows);
      return true;
    }
  }
  return false;
}

function statusRow(c: BrailleCanvas, state: HudState, pal: Palette, width: number, row: number): void {
  const prefix = `${t("scene.mainAgent")} · `;
  const status = statusLine(state);
  const warn = warningSuffix(state);
  const usePrefix = prefix.length + status.length + warn.length <= width;
  const full = (usePrefix ? prefix : "") + status + warn;
  const shown = full.length > width ? full.slice(0, width) : full;
  let col = Math.floor((width - shown.length) / 2);
  const hue = state.core.status === "error" ? "error" : state.core.status === "done" ? "success" : "accent";
  let rest = shown;
  if (usePrefix) {
    const part = rest.slice(0, prefix.length);
    c.text(col, row, part, shade(pal, "muted", 0.8));
    col += part.length;
    rest = rest.slice(part.length);
  }
  const statusPart = rest.slice(0, status.length);
  c.text(col, row, statusPart, shade(pal, hue, 1));
  if (rest.length > statusPart.length) c.text(col + statusPart.length, row, rest.slice(statusPart.length), shade(pal, "warning", 0.95));
}

/** `● 2  ✓ 1  ✗ 1` in the top-left corner; returns its width (0 when there is nothing to show). */
function countsRow(c: BrailleCanvas, state: HudState, pal: Palette): number {
  let running = 0;
  let done = 0;
  let failed = 0;
  for (const n of state.nodes) {
    if (n.status === "running") running++;
    else if (n.status === "completed") done++;
    else if (n.status === "failed") failed++;
  }
  let col = 1;
  const seg = (icon: string, n: number, hue: "accent" | "success" | "error"): void => {
    if (n === 0) return;
    const text = `${icon} ${n}`;
    c.text(col, 0, text, shade(pal, hue, 0.95));
    col += text.length + 2;
  };
  seg(taskSpinner(state.phase), running, "accent");
  seg("✓", done, "success");
  seg("✗", failed, "error");
  return col > 1 ? col : 0;
}

/**
 * Full-screen scene. `selectedId` highlights a node (ring on the node, bright label with an arrow). Below 16 columns or
 * 5 rows (or when the area is too small for a ring) the dock scene is returned instead. A new array is returned on every call.
 */
export function renderFullScene(state: HudState, width: number, height: number, theme: HudTheme, opts?: { selectedId?: string }): string[] {
  width = Math.floor(width);
  height = Math.floor(height);
  if (!(width > 0) || !(height > 0)) return [];
  if (width < MIN_COLS || height < MIN_ROWS) return renderOrbitScene(state, width, height, theme, opts);

  const hasStatus = height >= STATUS_ROW_MIN;
  const sceneRows = hasStatus ? height - 1 : height;
  const labels = width >= LABEL_MIN_COLS;
  const pw = width * 2;
  const ph = sceneRows * 4;

  // Node glyph scale follows the available height; the margins keep the node glow (and the label column) inside the canvas.
  const s = Math.min(2, Math.max(1, (ph / 2 - 6) * 0.026));
  const glow = NODE_R * s + 1;
  const marginY = Math.min(glow, Math.max(3.5, ph * 0.12));
  const labelPx = labels ? Math.min(20, pw * 0.1) : 0;
  const marginX = Math.min(glow, Math.max(3.5, pw * 0.04)) + labelPx;
  const ry = ph / 2 - marginY;
  const rx = Math.min(pw / 2 - marginX, ry * MAX_ASPECT);
  const base = Math.min(rx, ry);
  if (base < MIN_RADIUS) return renderOrbitScene(state, width, height, theme, opts);

  if (!canvas) canvas = new BrailleCanvas(width, height);
  else canvas.resize(width, height);
  const c = canvas;
  c.clear();
  const pal = paletteFor(theme);
  const cx = (pw - 1) / 2;
  const cy = (ph - 1) / 2;

  const big = ry >= BIG_MIN_RY;
  const spec: RingSpec = big ? BIG_RINGS : CLASSIC_RINGS;
  const coreBase = base * (big ? 0.4 : 0.56);
  const pos = drawRing(c, state, cx, cy, ry, theme, opts?.selectedId, {
    aspect: rx / ry,
    idleLife: true,
    coreR: coreBase,
    nodeScale: s,
    rings: spec,
    scaffold: true,
    sparks: big ? 10 : 6,
  });
  const idle = pos.length === 0;
  const coreR = coreBase * easeCoreScale(idle ? (big ? 1.25 : 1.5) : 1, state.now);
  drawCore(c, state, cx, cy, coreR, theme, true);
  if (coreR >= 22) drawCore(c, state, cx, cy, coreR + 1.6, theme, true); // a second stroke: the big core reads as a solid centerpiece

  const hidden = state.nodes.length - pos.length;
  if (labels) {
    if (occ.length < width * height) occ = new Uint8Array(width * height);
    else occ.fill(0, 0, width * height);
    if (hasStatus) markRect(0, sceneRows, width, 1, width, height);
    // core
    const coreCols = Math.ceil((coreR * 1.2) / 2);
    const coreRows = Math.ceil((coreR * 1.2) / 4);
    markRect(Math.floor(cx / 2) - coreCols, Math.floor(cy / 4) - coreRows, coreCols * 2 + 1, coreRows * 2 + 1, width, height);
    // node dots
    const dotCols = Math.ceil((NODE_R * s) / 2);
    const dotRowsN = dotRows(s);
    for (const p of pos) markRect(Math.floor(p.x / 2) - dotCols, Math.floor(p.y / 4) - dotRowsN, dotCols * 2 + 1, dotRowsN * 2 + 1, width, height);
    // corner texts
    if (height >= COUNTS_ROW_MIN && state.nodes.length > 0) {
      const used = countsRow(c, state, pal);
      if (used > 0) markRect(0, 0, used, 1, width, height);
    }
    if (hidden > 0) {
      const text = `+${hidden}`;
      c.text(Math.max(0, width - text.length - 1), 0, text, shade(pal, "muted", 0.9));
      markRect(Math.max(0, width - text.length - 2), 0, text.length + 2, 1, width, height);
    }
    const two = ry >= TWO_LINE_MIN_RY;
    const sel = opts?.selectedId;
    // The selected node first (its label always wins), then running nodes, then the rest.
    for (const p of pos) if (sel === p.node.id) placeLabel(c, pal, p, cx, s, state.now, state.phase, true, two);
    for (const p of pos) if (p.node.status === "running" && sel !== p.node.id) placeLabel(c, pal, p, cx, s, state.now, state.phase, false, two);
    for (const p of pos) if (p.node.status !== "running" && sel !== p.node.id) placeLabel(c, pal, p, cx, s, state.now, state.phase, false, two);
  } else if (hidden > 0) c.text(0, 0, `+${hidden}`, shade(pal, "muted", 0.9));

  if (hasStatus) statusRow(c, state, pal, width, sceneRows);
  return c.toRows(theme).slice();
}
