// HUD preview without omp. Usage: bun scripts/preview.ts --help
// Virtual time: Date.now is patched and the demo advances in 100 ms steps (no real waiting).
import { installPiTuiShim } from "./shim-pi-tui.ts";
import { framesToHtml, type HtmlFrame } from "./ansi-to-html.ts";
import type { HudStore, HudTask, HudTheme } from "../src/types.ts";
import type { createStore } from "../src/store.ts";
import type { DemoDriver } from "../src/demo.ts";
import type { FullHud } from "../src/components/full-hud.ts";
import type { CompactHud } from "../src/components/compact-hud.ts";
import type { DockHud, dockHeightFor } from "../src/components/dock-hud.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Untyped timers of globalThis (because tsconfig has types: []).
const host = globalThis as unknown as {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(h: unknown): void;
};

const HELP = `HUD preview (no omp needed)

Usage:
  bun scripts/preview.ts --frames N [--width W] [--height H] [--at 0,5,12,20,30] [--html out.html] [--compact]
  bun scripts/preview.ts --live [--compact]
  bun scripts/preview.ts --dock [--size small|medium|large] [--width W] [--rows R] [--at 3,14,24] [--idle empty|tasks|used] [--html out.html]

Options:
  --frames N       print N frames (evenly spread over 2..42 s unless --at is given)
  --at LIST        virtual seconds, comma separated (example 0,5,12,20,30); replaces --frames
  --width W        columns (default 140)        --height H   rows (default 40)
  --html FILE      write all frames into one HTML file (black background, Menlo, fixed cell)
  --columns K      grid columns in the HTML output (default 1: stacked)
  --compact        also render the compact widget below every frame
  --dock           render the dock (panel above the editor) instead of the fullscreen HUD
  --size S         dock size: small (8 rows) | medium (12) | large (16, default); capped at 45% of --rows
  --rows R         terminal rows the dock height is derived from (default 40)
  --idle KIND      dock only: no demo; a resting store instead. empty = fresh session, tasks = 52 tasks of which 17 blocked
                   (like a real "all that is left is waiting" session), used = a finished turn with tokens and events
  --live           watch live in a real terminal on the alternate screen (~15 fps; Esc / Ctrl-C quits; the prompt works, sent text only lands in the conversation)
  --help           this help

Language: set OMP_HUD_LANG=en or OMP_HUD_LANG=tr.
Example (visual check): bun scripts/preview.ts --frames 4 --width 140 --height 40 --html /tmp/hud.html
Example (dock): bun scripts/preview.ts --dock --size large --width 200 --rows 45 --at 3,14,24,36 --html /tmp/dock.html
`;

interface Args {
  frames?: number;
  at?: number[];
  width: number;
  height: number;
  html?: string;
  columns: number;
  compact: boolean;
  live: boolean;
  help: boolean;
  dock: boolean;
  size: "small" | "medium" | "large";
  rows: number;
  idle?: "empty" | "tasks" | "used";
}

function parseArgs(argv: string[]): Args | string {
  const a: Args = { width: 140, height: 40, columns: 1, compact: false, live: false, help: false, dock: false, size: "large", rows: 40 };
  const num = (flag: string, v: string | undefined): number | string => {
    const n = Number(v);
    return v !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : `${flag} needs a positive number`;
  };
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i]!;
    const v = argv[i + 1];
    switch (f) {
      case "--help":
      case "-h":
        a.help = true;
        break;
      case "--live":
        a.live = true;
        break;
      case "--compact":
        a.compact = true;
        break;
      case "--dock":
        a.dock = true;
        break;
      case "--size":
        if (v !== "small" && v !== "medium" && v !== "large") return "--size needs small, medium or large";
        a.size = v;
        i++;
        break;
      case "--idle":
        if (v !== "empty" && v !== "tasks" && v !== "used") return "--idle needs empty, tasks or used";
        a.idle = v;
        i++;
        break;
      case "--rows": {
        const n = num(f, v);
        if (typeof n === "string") return n;
        a.rows = n;
        i++;
        break;
      }
      case "--frames":
      case "--width":
      case "--height":
      case "--columns": {
        const n = num(f, v);
        if (typeof n === "string") return n;
        if (f === "--frames") a.frames = n;
        else if (f === "--width") a.width = n;
        else if (f === "--height") a.height = n;
        else a.columns = n;
        i++;
        break;
      }
      case "--at": {
        const list = (v ?? "").split(",").map((s) => Number(s.trim()));
        if (!v || list.some((n) => !Number.isFinite(n) || n < 0)) return "--at needs a comma separated list of seconds (example 0,5,12)";
        a.at = list.sort((x, y) => x - y);
        i++;
        break;
      }
      case "--html":
        if (!v) return "--html needs a file path";
        a.html = v;
        i++;
        break;
      default:
        return `bilinmeyen secenek: ${f}`;
    }
  }
  return a;
}

/** Our own fake truecolor theme (there is no omp theme outside omp). */
function makeTheme(): HudTheme {
  const rgb: Record<string, [number, number, number]> = {
    accent: [56, 225, 255],
    success: [61, 220, 132],
    error: [255, 77, 94],
    warning: [255, 180, 84],
    muted: [138, 148, 166],
    dim: [75, 85, 99],
    text: [214, 222, 235],
  };
  return {
    truecolor: true,
    fg(color, text) {
      const c = rgb[color] ?? rgb.text!;
      return `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${text}\x1b[39m`;
    },
    bold(text) {
      return `\x1b[1m${text}\x1b[22m`;
    },
  };
}

interface Loaded {
  createStore: typeof createStore;
  DemoDriver: typeof DemoDriver;
  FullHud: typeof FullHud;
  CompactHud?: typeof CompactHud;
  DockHud?: typeof DockHud;
  dockHeightFor?: typeof dockHeightFor;
  vw: (s: string) => number;
}

async function load(needCompact: boolean, needDock = false): Promise<Loaded> {
  installPiTuiShim();
  const need = async <T,>(label: string, loader: () => Promise<T>): Promise<T> => {
    try {
      return await loader();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`ERROR: could not load ${label} (${msg}).`);
      console.error("The file is missing or has a build error.");
      process.exit(2);
    }
  };
  // Dynamic: the shim must be registered first; also yields a clean error if a file is missing (a static import cannot).
  const store = await need("src/store.ts", () => import("../src/store.ts"));
  const demo = await need("src/demo.ts", () => import("../src/demo.ts"));
  const full = await need("src/components/full-hud.ts", () => import("../src/components/full-hud.ts"));
  const text = await need("src/util/text.ts", () => import("../src/util/text.ts"));
  const compact = needCompact ? await need("src/components/compact-hud.ts", () => import("../src/components/compact-hud.ts")) : undefined;
  const dock = needDock ? await need("src/components/dock-hud.ts", () => import("../src/components/dock-hud.ts")) : undefined;
  return {
    createStore: store.createStore,
    DemoDriver: demo.DemoDriver,
    FullHud: full.FullHud,
    CompactHud: compact?.CompactHud,
    DockHud: dock?.DockHud,
    dockHeightFor: dock?.dockHeightFor,
    vw: text.vw,
  };
}

// ---------------------------------------------------------------- idle stores (preview --dock --idle)

type IdleKind = NonNullable<Args["idle"]>;

/** A resting store without any demo: empty session, a task list that is mostly blocked, or a finished turn. */
function seedIdle(store: HudStore, kind: IdleKind, now: number): void {
  if (kind === "tasks") {
    const tasks: HudTask[] = [];
    for (let i = 1; i <= 52; i++) {
      const status: HudTask["status"] = i <= 35 ? "completed" : "blocked";
      tasks.push({ phase: i <= 35 ? "Build" : "Hand-off", content: i <= 35 ? `Build step ${i}` : `Owner decision ${i - 35} (waiting for feedback)`, status });
    }
    store.setTasks(tasks);
  }
  if (kind === "used") {
    store.setCoreStatus("done");
    store.incrementTurn();
    store.addUsage({ input: 48_200, output: 9_100, cacheRead: 120_000, cacheWrite: 6_000, cost: 0.84 });
    store.setCtxPct(38);
    store.setTasks([
      { phase: "Plan", content: "Read the render layer", status: "completed" },
      { phase: "Plan", content: "Write the dock layout", status: "completed" },
      { phase: "Plan", content: "Check wide terminals", status: "pending" },
      { phase: "Plan", content: "Update the README", status: "pending" },
    ]);
    const events: { kind: "tool" | "message" | "todo"; text: string }[] = [
      { kind: "tool", text: "read src/render/dock.ts" },
      { kind: "tool", text: 'grep "renderOrbitScene"' },
      { kind: "tool", text: "edit src/render/dock.ts" },
      { kind: "tool", text: "bash bun scripts/smoke-collector.ts" },
      { kind: "todo", text: "tasks: 2/4 done" },
      { kind: "message", text: "turn finished" },
    ];
    events.forEach((e, i) => store.pushFeed({ agent: "main", kind: e.kind, text: e.text, t: now - (events.length - i) * 4000 }));
  }
}

// ---------------------------------------------------------------- static frames

async function runFrames(args: Args): Promise<void> {
  const times: number[] =
    args.at ??
    (() => {
      const n = args.frames ?? 4;
      if (n === 1) return [12];
      return Array.from({ length: n }, (_, i) => Math.round((2 + (40 * i) / (n - 1)) * 10) / 10);
    })();

  // virtual clock: store.ts, demo.ts and the render code all see Date.now from here
  let vnow = Date.UTC(2026, 9, 11, 12, 0, 0);
  const realNow = Date.now;
  Date.now = () => vnow;
  try {
    const L = await load(args.compact, args.dock);
    const theme = makeTheme();
    const store = L.createStore();
    let tick: (() => void) | undefined;
    const driver = new L.DemoDriver(store, {
      setInterval(fn) {
        tick = fn;
        return 1;
      },
      clearTimer() {
        tick = undefined;
      },
    });
    const hud = args.dock ? undefined : new L.FullHud(store, theme, () => {}, () => {}, () => args.height);
    const compact = L.CompactHud ? new L.CompactHud(store, theme) : undefined;
    const dock = L.DockHud ? new L.DockHud(store, theme, { getSize: () => args.size, getRows: () => args.rows }) : undefined;
    if (args.idle) seedIdle(store, args.idle, vnow);
    else driver.start();

    const STEP = 100;
    let elapsed = 0;
    const frames: HtmlFrame[] = [];
    const warnings: string[] = [];
    const check = (label: string, lines: readonly string[], width: number, height?: number): void => {
      if (height !== undefined && lines.length !== height) warnings.push(`${label}: ${lines.length} rows (expected ${height})`);
      lines.forEach((l, i) => {
        const w = L.vw(l);
        if (w > width) warnings.push(`${label}: row ${i + 1} width ${w} > ${width}`);
      });
    };

    for (const t of times) {
      while (elapsed < t * 1000) {
        vnow += STEP;
        elapsed += STEP;
        tick?.();
        store.tickAnimation(STEP);
      }
      const label = `t=${t}s`;
      if (dock && L.dockHeightFor) {
        const dl = dock.render(args.width);
        check(`${label} dock`, dl, args.width, L.dockHeightFor(args.size, args.rows));
        frames.push({ title: `${label} · dock ${args.size} ${args.width}x${dl.length} (rows ${args.rows}) · nodes ${store.state.nodes.length}`, lines: [...dl] });
        continue;
      }
      const lines = hud!.render(args.width);
      check(`${label} full`, lines, args.width, args.height);
      frames.push({ title: `${label} · fullscreen ${args.width}x${args.height} · nodes ${store.state.nodes.length}`, lines: [...lines] });
      if (compact) {
        const cl = compact.render(args.width);
        check(`${label} compact`, cl, args.width);
        frames.push({ title: `${label} · compact (${cl.length} rows)`, lines: [...cl] });
      }
    }
    driver.stop();

    if (args.html) {
      const out = resolve(args.html);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, framesToHtml(frames, { title: "HUD preview", columns: args.columns }));
      console.log(`wrote ${frames.length} frames: ${out}`);
    } else {
      for (const f of frames) {
        console.log(`\x1b[0m── ${f.title} ──`);
        for (const l of f.lines) console.log(`${l}\x1b[0m`);
      }
    }
    for (const w of warnings) console.error(`WARNING ${w}`);
    if (warnings.length > 0) process.exit(1);
  } finally {
    Date.now = realNow;
  }
}

// ---------------------------------------------------------------- live mode

interface LiveProcess {
  stdin: {
    isTTY?: boolean;
    setRawMode?(on: boolean): void;
    resume(): void;
    pause(): void;
    on(ev: "data", fn: (chunk: { toString(): string }) => void): void;
  };
  stdout: { isTTY?: boolean; columns?: number; rows?: number; write(s: string): boolean };
  on(ev: string, fn: (...a: unknown[]) => void): void;
  exit(code?: number): never;
}

async function runLive(args: Args): Promise<void> {
  const p = process as unknown as LiveProcess;
  if (!p.stdout.isTTY || !p.stdin.isTTY) {
    console.error("ERROR: --live needs a real terminal (TTY).");
    process.exit(2);
  }
  const L = await load(args.compact);
  const theme = makeTheme();
  const store = L.createStore();
  const driver = new L.DemoDriver(store);
  const compact = L.CompactHud ? new L.CompactHud(store, theme) : undefined;
  const size = (): { w: number; h: number } => ({ w: p.stdout.columns || 100, h: p.stdout.rows || 30 });

  let restored = false;
  let timer: unknown;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (timer !== undefined) host.clearInterval(timer);
    try {
      driver.stop();
    } catch {
      // ignore
    }
    try {
      p.stdin.setRawMode?.(false);
      p.stdin.pause();
    } catch {
      // ignore
    }
    p.stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
  };
  const quit = (code = 0): never => {
    restore();
    return p.exit(code);
  };

  let reqRows = size().h;
  const hud = new L.FullHud(store, theme, () => {}, () => quit(0), () => reqRows, {
    send: (text) => void store.addChat({ role: "user", text }),
    command: () => {},
  });
  p.on("exit", restore);
  p.on("SIGINT", () => quit(0));
  p.on("SIGTERM", () => quit(0));
  p.on("uncaughtException", (e) => {
    restore();
    console.error("ERROR:", e instanceof Error ? (e.stack ?? e.message) : String(e));
    p.exit(1);
  });

  p.stdout.write("\x1b[?1049h\x1b[?25l\x1b[2J");
  p.stdin.setRawMode?.(true);
  p.stdin.resume();
  p.stdin.on("data", (chunk) => {
    const s = chunk.toString();
    if (s === "\x03") quit(0); // Esc is handled by the HUD itself (it clears the prompt first); letters go to the prompt
    try {
      hud.handleInput?.(s);
    } catch {
      // a component error must not kill the live view
    }
  });

  driver.start();
  let prev: string[] = [];
  let prevSize = "";
  const FRAME_MS = 66;
  timer = host.setInterval(() => {
    try {
      const { w, h } = size();
      store.tickAnimation(FRAME_MS);
      const cl = compact ? compact.render(w) : [];
      reqRows = Math.max(1, h - cl.length);
      const full = hud.render(w);
      const lines = [...full.slice(0, reqRows), ...cl].slice(0, h);
      const sz = `${w}x${h}`;
      if (sz !== prevSize) {
        p.stdout.write("\x1b[2J");
        prev = [];
        prevSize = sz;
      }
      let buf = "";
      for (let i = 0; i < h; i++) {
        const line = lines[i] ?? "";
        if (prev[i] !== line) buf += `\x1b[${i + 1};1H${line}\x1b[0m\x1b[K`;
        prev[i] = line;
      }
      if (buf) p.stdout.write(buf);
    } catch (e) {
      restore();
      console.error("ERROR:", e instanceof Error ? (e.stack ?? e.message) : String(e));
      p.exit(1);
    }
  }, FRAME_MS);

  await new Promise<void>(() => {}); // exit happens through quit()
}

// ---------------------------------------------------------------- entry

const parsed = parseArgs(process.argv.slice(2));
if (typeof parsed === "string") {
  console.error(`ERROR: ${parsed}\n`);
  console.error(HELP);
  process.exit(2);
}
if (parsed.help || (!parsed.live && !parsed.dock && parsed.frames === undefined && parsed.at === undefined)) {
  console.log(HELP);
  process.exit(parsed.help ? 0 : 2);
}
if (parsed.live) await runLive(parsed);
else await runFrames(parsed);
