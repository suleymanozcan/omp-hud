// Animated core: a pure function; everything derives from state.phase (seconds) and core.statusSince.

import type { HudState } from "../types";
import { BrailleCanvas, type Hue, type Palette, hash01, paletteFor, shade } from "./canvas";
import type { HudTheme } from "../types";

const TAU = Math.PI * 2;
const BLEND_MS = 320;
const FLASH_MS = 420;
const DONE_PULSE_S = 1.2;

function frac(x: number): number {
  return x - Math.floor(x);
}
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function smooth(x: number): number {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

function drawBreath(c: BrailleCanvas, pal: Palette, cx: number, cy: number, R: number, t: number, gain: number, hue: Hue): void {
  const breath = 0.5 + 0.5 * Math.sin(TAU * 0.25 * t);
  for (let i = 0; i < 3; i++) {
    const r = R * (0.34 + 0.28 * i) * (1 + 0.05 * breath * ((i + 1) / 3));
    const inten = (0.5 + 0.35 * breath) * (1 - i * 0.15) * gain;
    c.circle(cx, cy, r, shade(pal, hue, inten));
  }
  const s = Math.sin(TAU * 0.5 * t);
  const beat = s > 0 ? s * s : 0;
  c.fillCircle(cx, cy, 1 + beat, shade(pal, hue, (0.6 + 0.4 * beat) * gain));
}

function drawThinking(c: BrailleCanvas, pal: Palette, cx: number, cy: number, R: number, t: number, gain: number): void {
  const rad = [0.4, 0.68, 0.95];
  const span = [1.75, 2.6, 3.7];
  const speed = [1.7, -1.15, 0.75];
  const inten = [0.95, 0.8, 0.65];
  for (let i = 0; i < 3; i++) {
    const r = R * rad[i];
    c.circle(cx, cy, r, shade(pal, "accent", 0.16 * gain));
    const a0 = speed[i] * t + i * 2.1;
    const col = shade(pal, "accent", inten[i] * gain);
    c.arc(cx, cy, r, a0, a0 + span[i], col);
    c.arc(cx, cy, r - 1, a0 + 0.04, a0 + span[i] - 0.04, shade(pal, "accent", inten[i] * 0.8 * gain));
  }
  const p = 0.5 + 0.5 * Math.sin(TAU * 2 * t);
  c.fillCircle(cx, cy, 1.2 + 1.4 * p, shade(pal, "accent", (0.55 + 0.45 * p) * gain));
}

function drawStreaming(c: BrailleCanvas, pal: Palette, cx: number, cy: number, R: number, t: number, gain: number): void {
  c.circle(cx, cy, R * 0.97, shade(pal, "accent", 0.3 * gain));
  const f = frac(t * 1.5);
  for (let i = 0; i < 3; i++) {
    const p = (f + i) / 3; // 0..1 radius ratio
    const fadeIn = clamp01(p / 0.12);
    const fadeOut = 1 - smooth((p - 0.8) / 0.2);
    const inten = (1 - p * 0.55) * fadeIn * fadeOut * gain;
    const col = shade(pal, "accent", inten);
    c.circle(cx, cy, R * 0.97 * p, col);
    c.circle(cx, cy, R * 0.97 * p - 1, col);
  }
  c.fillCircle(cx, cy, 2, shade(pal, "accent", 1 * gain));
}

function drawTool(c: BrailleCanvas, pal: Palette, cx: number, cy: number, R: number, t: number, gain: number): void {
  const head = (t * 7) % 8;
  const r = R * 0.88;
  const half = (TAU / 8) * 0.38;
  for (let k = 0; k < 8; k++) {
    let d = (head - k) % 8;
    if (d < 0) d += 8;
    const inten = (0.14 + 0.86 * Math.pow(clamp01(1 - d / 3.5), 1.6)) * gain;
    const mid = (k * TAU) / 8;
    c.arc(cx, cy, r + 1, mid - half, mid + half, shade(pal, "accent", inten * 0.8));
    c.arc(cx, cy, r, mid - half, mid + half, shade(pal, "accent", inten));
    c.arc(cx, cy, r - 1, mid - half, mid + half, shade(pal, "accent", inten * 0.8));
  }
  c.circle(cx, cy, R * 0.52, shade(pal, "accent", 0.3 * gain), 2);
  for (let k = 0; k < 4; k++) {
    const a = -t * 2.2 + (k * TAU) / 4;
    const x0 = cx + Math.cos(a) * R * 0.4;
    const y0 = cy + Math.sin(a) * R * 0.4;
    const x1 = cx + Math.cos(a) * R * 0.62;
    const y1 = cy + Math.sin(a) * R * 0.62;
    c.line(x0, y0, x1, y1, shade(pal, "accent", 0.8 * gain));
  }
  c.fillCircle(cx, cy, 1.5, shade(pal, "accent", 0.9 * gain));
}

function drawError(c: BrailleCanvas, pal: Palette, cx: number, cy: number, R: number, t: number, sinceS: number, gain: number): void {
  const amp = 0.35 + 0.65 * Math.exp(-sinceS * 1.2);
  const frame = Math.floor(t * 24);
  const N = 20;
  const flick = 0.6 + 0.4 * hash01(frame * 7 + 3);
  for (let s = 0; s < N; s++) {
    if (hash01(frame * 31 + s) < 0.1 + 0.22 * amp) continue;
    const jit = (hash01(frame * 17 + s * 3 + 1) - 0.5) * 3.2 * amp;
    const a = (s * TAU) / N;
    const inten = (0.55 + 0.45 * hash01(frame * 13 + s * 5)) * gain;
    c.arc(cx, cy, R * 0.88 + jit, a, a + (TAU / N) * 0.92, shade(pal, "error", inten));
  }
  c.circle(cx, cy, R * 0.55, shade(pal, "error", (0.28 + 0.3 * flick) * gain), 3);
  const noise = 6 + Math.floor(10 * amp);
  for (let k = 0; k < noise; k++) {
    const a = hash01(frame * 101 + k * 7) * TAU;
    const d = Math.sqrt(hash01(frame * 59 + k * 11 + 5)) * R;
    c.set(cx + Math.cos(a) * d, cy + Math.sin(a) * d, shade(pal, "error", (0.4 + 0.6 * hash01(frame + k)) * gain));
  }
  const x = R * 0.2;
  const col = shade(pal, "error", 0.95 * flick * gain);
  c.line(cx - x, cy - x, cx + x, cy + x, col);
  c.line(cx - x, cy + x, cx + x, cy - x, col);
}

function drawDone(c: BrailleCanvas, pal: Palette, cx: number, cy: number, R: number, t: number, sinceS: number, gain: number): void {
  const p = sinceS / DONE_PULSE_S;
  drawBreath(c, pal, cx, cy, R, t, gain * (0.6 + 0.4 * smooth(p - 0.3)), "success");
  if (p < 1) {
    const e = 1 - (1 - p) * (1 - p);
    c.circle(cx, cy, R * (0.25 + 0.75 * e), shade(pal, "success", 1 - p));
    const p2 = p - 0.15;
    if (p2 > 0) {
      const e2 = 1 - (1 - p2) * (1 - p2);
      c.circle(cx, cy, R * (0.25 + 0.75 * e2), shade(pal, "success", (1 - p2) * 0.55));
    }
    c.fillCircle(cx, cy, 1 + 2 * (1 - p), shade(pal, "success", 1));
  }
}

function drawWarning(c: BrailleCanvas, pal: Palette, cx: number, cy: number, R: number, t: number): void {
  const n = 14;
  const r = R * 1.12;
  const col = shade(pal, "warning", 0.95);
  for (let k = 0; k < n; k++) {
    const a = t * 0.9 + (k * TAU) / n;
    c.arc(cx, cy, r, a, a + (TAU / n) * 0.5, col);
  }
}

/** Draws the core (cx,cy: sub-pixels; radius: sub-pixels). */
export function drawCore(c: BrailleCanvas, state: HudState, cx: number, cy: number, radius: number, theme: HudTheme): void {
  const pal = paletteFor(theme);
  const core = state.core;
  const t = state.phase;
  const sinceMs = Math.max(0, state.now - core.statusSince);
  const gain = 0.4 + 0.6 * smooth(sinceMs / BLEND_MS);
  switch (core.status) {
    case "thinking":
      drawThinking(c, pal, cx, cy, radius, t, gain);
      break;
    case "streaming":
      drawStreaming(c, pal, cx, cy, radius, t, gain);
      break;
    case "tool":
      drawTool(c, pal, cx, cy, radius, t, gain);
      break;
    case "error":
      drawError(c, pal, cx, cy, radius, t, sinceMs / 1000, gain);
      break;
    case "done":
      drawDone(c, pal, cx, cy, radius, t, sinceMs / 1000, gain);
      break;
    default:
      drawBreath(c, pal, cx, cy, radius, t, gain, "accent");
  }
  if (core.warning) drawWarning(c, pal, cx, cy, radius, t);
  if (sinceMs < FLASH_MS) {
    const p = sinceMs / FLASH_MS;
    const hue: Hue = core.status === "error" ? "error" : core.status === "done" ? "success" : "accent";
    c.circle(cx, cy, radius * (0.15 + 0.9 * p), shade(pal, hue, (1 - p) * 0.9));
  }
}
