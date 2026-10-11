// Dock orbit scene: core + elliptic orbits + node dots. Exactly `height` rows, every row exactly `width` cells.
// The width guarantee is structural: braille cells are single-cell and the labels are plain Latin text.
// (The full-screen scene with node labels lives in full-scene.ts.)

import type { HudState, HudTheme } from "../types";
import { t } from "../i18n.ts";
import { BrailleCanvas, type Palette, paletteFor, shade } from "./canvas";
import { drawCore } from "./core";
import { CORE_RATIO, drawRing } from "./ring";
import { statusLine } from "./scene-text.ts";

const MIN_COLS = 16;
const MIN_ROWS = 5;
const MIN_RADIUS = 6;
const CORE_EASE_MS = 400;
const MARGIN = 6; // max sub-pixels kept free around the elliptic orbits (node glow radius); less on short areas
const CORE_RATIO_WIDE = 0.56;
const EMPTY_CORE_SCALE = 1.5;

let canvas: BrailleCanvas | null = null;
let blank = "";
let blankWidth = -1;
let coreScale = 1;
let coreScaleAt = -1;

/** Moves the core scale toward `target` over ~400 ms of state time (the first call snaps). */
function easeCoreScale(target: number, now: number): number {
  const dt = coreScaleAt < 0 ? Number.POSITIVE_INFINITY : Math.max(0, now - coreScaleAt);
  coreScaleAt = now;
  const step = (dt / CORE_EASE_MS) * (EMPTY_CORE_SCALE - 1);
  coreScale = coreScale < target ? Math.min(target, coreScale + step) : Math.max(target, coreScale - step);
  return coreScale;
}

/** Short caption under the core of an idle scene: `main agent · ready` (or just the status when narrow). */
function idleLabel(c: BrailleCanvas, state: HudState, pal: Palette, cy: number, coreR: number, width: number, height: number): void {
  const status = statusLine(state);
  const prefix = `${t("scene.mainAgent")} · `;
  const usePrefix = prefix.length + status.length + 4 <= width;
  const text = ` ${usePrefix ? prefix : ""}${status} `;
  if (text.length > width) return;
  const col = Math.floor((width - text.length) / 2);
  const row = Math.min(height - 1, Math.floor((cy + coreR) / 4) + 1);
  const hue = state.core.status === "error" ? "error" : state.core.status === "done" ? "success" : "accent";
  if (usePrefix) {
    c.text(col, row, ` ${prefix}`, shade(pal, "muted", 0.85));
    c.text(col + prefix.length + 1, row, `${status} `, shade(pal, hue, 1));
  } else c.text(col, row, text, shade(pal, hue, 1));
}

function blankLine(width: number): string {
  if (blankWidth !== width) {
    blank = " ".repeat(width);
    blankWidth = width;
  }
  return blank;
}

/** One-line summary for areas too small for a scene. */
export function tinyScene(state: HudState, width: number, height: number, theme: HudTheme): string[] {
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

/**
 * Dock scene: exactly `height` rows, each with visible width == width (space padded). Below 16 columns / 5 rows it is a
 * one-line summary. A new array is returned on every call (the cell arrays are reused by the internal canvas).
 *
 * The core stays a circle (square sub-pixels), the orbits become ellipses that fill the whole area, the resting core is
 * brighter, and an idle scene (no nodes) shows dim placeholder sparkles plus a short status label under the core.
 * There are no node-name labels: only node dots (a `+N` marks nodes that did not fit).
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

  const pal = paletteFor(theme);
  const pw = width * 2;
  const ph = height * 4;
  const cx = (pw - 1) / 2;
  const cy = (ph - 1) / 2;
  // y radius from the height, x radius from the width: the orbits fill the area (never narrower than a circle).
  const margin = Math.min(MARGIN, Math.max(3.5, ph * 0.12));
  const ry = ph / 2 - margin;
  const rx = pw / 2 - margin;
  const radius = Math.min(ry, rx);
  const aspect = rx / radius;
  if (radius < MIN_RADIUS) return tinyScene(state, width, height, theme);

  const pos = drawRing(c, state, cx, cy, radius, theme, opts?.selectedId, {
    aspect,
    idleLife: true,
    coreR: radius * CORE_RATIO_WIDE,
    nodeScale: Math.min(1.7, Math.max(1, radius / 16)),
  });
  // With no nodes the core grows to fill the area (eased, so a first node does not make it jump).
  const idle = pos.length === 0;
  const coreR = radius * CORE_RATIO_WIDE * easeCoreScale(idle ? EMPTY_CORE_SCALE : 1, state.now);
  drawCore(c, state, cx, cy, coreR, theme, true);
  if (idle) idleLabel(c, state, pal, cy, coreR, width, height);

  const hidden = state.nodes.length - pos.length;
  if (hidden > 0) c.text(0, 0, `+${hidden}`, shade(pal, "muted", 0.9));
  return c.toRows(theme).slice();
}
