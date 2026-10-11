// omp slash commands inside the full-screen HUD. omp has no API that runs a command (`pi.sendUserMessage` does not expand them),
// so a line is submitted through omp's own editor while the HUD is hidden; completion comes from omp's autocomplete provider.
// Everything here is duck-typed against undocumented TUI surfaces (`getFocused`, `hasOverlay`, `children`; verified on omp 18.8.9):
// when one is missing the functions say so instead of throwing.
import type { Completion, Suggestion, Suggestions } from "./chat.ts";

export const POLL_MS = 50; // how often the focus is looked at after a submit
export const SETTLE_MS = 200; // a command that has not taken the focus away by then is treated as a "transcript only" command

// ---------------------------------------------------------------- classifying a line

/** `hud`: a `/hud ...` line (run locally); `command`: another `/command`; `shell`: `!cmd` / `!!cmd`; `python`: `$ code`; `text`: a message for the agent. */
export type LineKind = "hud" | "command" | "shell" | "python" | "text";

export function lineKind(text: string): LineKind {
  if (/^\/hud(?:\s|$)/i.test(text)) return "hud";
  if (text.startsWith("/")) return "command";
  if (text.startsWith("!")) return "shell";
  if (/^\$(?:\s|$)/.test(text)) return "python";
  return "text";
}

/** `/ping x` -> `ping`; `/skill:name args` -> `skill:name`. */
export function commandName(text: string): string {
  return /^\/(\S*)/.exec(text)?.[1] ?? "";
}

/** Whether the prompt text should show the palette: a `/command` at the start, or an `@file` mention at the cursor. */
export function wantsPalette(text: string, cursor: number): boolean {
  const kind = lineKind(text);
  if (kind === "shell" || kind === "python") return false;
  if (kind === "command" && cursor > 0) return true;
  return /(?:^|\s)@\S*$/.test(text.slice(0, cursor));
}

/** True for data that is a key the user pressed (not a focus report, a mouse report or a terminal answer). */
export function isUserKey(data: string): boolean {
  if (data === "") return false;
  if (data.startsWith("\x1b[I") || data.startsWith("\x1b[O")) return false; // focus in / out
  if (data.startsWith("\x1b[<") || data.startsWith("\x1b[M")) return false; // mouse
  if (data.startsWith("\x1b]") || data.startsWith("\x1bP") || data.startsWith("\x1b[?")) return false; // OSC / DCS / mode answers
  return true;
}

// ---------------------------------------------------------------- omp's autocomplete provider

/** The slice of omp's autocomplete provider that is used. */
export interface BaseProvider {
  getSuggestions(lines: string[], cursorLine: number, cursorCol: number, signal?: AbortSignal): unknown;
  applyCompletion(lines: string[], cursorLine: number, cursorCol: number, item: unknown, prefix: string): unknown;
}

/** The provider when it has both methods, else undefined. */
export function asBase(b: unknown): BaseProvider | undefined {
  const o = rec(b);
  return o && typeof o.getSuggestions === "function" && typeof o.applyCompletion === "function" ? (b as BaseProvider) : undefined;
}

function rec(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** `{items, prefix}` of the provider -> `Suggestions`; null when empty or malformed. */
export function normalizeSuggestions(raw: unknown): Suggestions | null {
  const r = rec(raw);
  if (!r || !Array.isArray(r.items)) return null;
  const items: Suggestion[] = [];
  for (const it of r.items) {
    const o = rec(it);
    const value = str(o?.value);
    if (!o || value === undefined) continue;
    const description = str(o.description);
    const argumentHint = str(o.argumentHint);
    items.push({
      value,
      label: str(o.label) ?? value,
      ...(description !== undefined && description !== "" ? { description } : {}),
      ...(argumentHint !== undefined && argumentHint !== "" ? { argumentHint } : {}),
      raw: it,
    });
  }
  return items.length === 0 ? null : { items, prefix: str(r.prefix) ?? "" };
}

/** Command name of a suggestion: `/tools ` -> `tools`. */
export function suggestionName(s: Suggestion): string {
  return (/^\/?(\S*)/.exec(s.value.trimStart())?.[1] ?? "").toLowerCase();
}

export async function querySuggestions(base: BaseProvider, text: string, cursor: number, signal?: AbortSignal): Promise<Suggestions | null> {
  return normalizeSuggestions(await base.getSuggestions([text], 0, cursor, signal));
}

/** The provider's result of applying `item`; undefined when it returned something unusable. */
export function applySuggestion(base: BaseProvider, text: string, cursor: number, item: Suggestion, prefix: string): Completion | undefined {
  const r = rec(base.applyCompletion([text], 0, cursor, item.raw, prefix));
  if (!r || !Array.isArray(r.lines)) return undefined;
  const lines = r.lines.filter((l): l is string => typeof l === "string");
  if (lines.length === 0) return undefined;
  const out = lines.join(" ");
  const col = typeof r.cursorCol === "number" && r.cursorLine === 0 ? r.cursorCol : out.length;
  const onApplied = r.onApplied;
  if (typeof onApplied === "function") {
    try {
      (onApplied as () => void)();
    } catch {
      // usage bookkeeping of omp: not needed here
    }
  }
  return { text: out, cursor: Math.max(0, Math.min(out.length, col)) };
}

/** Whether omp knows the command `name`: true/false, or undefined when the provider cannot tell (no provider, it threw). */
export async function commandIsKnown(base: BaseProvider | undefined, name: string): Promise<boolean | undefined> {
  if (!base || name === "") return base ? false : undefined;
  try {
    const res = await querySuggestions(base, `/${name}`, name.length + 1);
    const want = name.toLowerCase();
    return res?.items.some((s) => suggestionName(s) === want) ?? false;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- finding omp's editor

export interface TuiLike {
  getFocused?(): unknown;
  hasOverlay?(): boolean;
  children?: readonly unknown[];
}

export interface EditorLike {
  submit(): void;
  setText(text: string): void;
  getText(): string;
  disableSubmit?: boolean;
}

export function isEditor(o: unknown): o is EditorLike {
  const e = rec(o);
  return !!e && typeof e.submit === "function" && typeof e.setText === "function" && typeof e.getText === "function";
}

const TREE_DEPTH = 8;
const TREE_NODES = 2000;

/** The editor: the focused component when it looks like one (a hidden overlay hands the focus back to it), else a walk through `tui.children`. */
export function findEditor(tui: TuiLike | undefined): { editor?: EditorLike; via: "focused" | "tree" | "none" } {
  if (!tui) return { via: "none" };
  try {
    const f = typeof tui.getFocused === "function" ? tui.getFocused() : undefined;
    if (isEditor(f)) return { editor: f, via: "focused" };
    const seen = new Set<unknown>();
    let budget = TREE_NODES;
    const walk = (nodes: readonly unknown[] | undefined, depth: number): EditorLike | undefined => {
      if (!nodes || depth > TREE_DEPTH) return undefined;
      for (const n of nodes) {
        if (budget-- <= 0) return undefined;
        if (typeof n !== "object" || n === null || seen.has(n)) continue;
        seen.add(n);
        if (isEditor(n)) return n;
        const kids = rec(n)?.children;
        const hit = Array.isArray(kids) ? walk(kids, depth + 1) : undefined;
        if (hit) return hit;
      }
      return undefined;
    };
    const found = walk(tui.children, 0);
    return found ? { editor: found, via: "tree" } : { via: "none" };
  } catch {
    return { via: "none" };
  }
}

/** The editor has the focus and no overlay is on screen; true when the TUI cannot tell. */
export function editorHasFocus(tui: TuiLike | undefined, editor: EditorLike): boolean {
  if (!tui || typeof tui.getFocused !== "function") return true;
  try {
    return tui.getFocused() === editor && !(typeof tui.hasOverlay === "function" && tui.hasOverlay());
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------- running a line through the editor

/** What the router needs from the extension; everything omp-specific lives behind these functions. */
export interface RouteEnv {
  tui(): TuiLike | undefined;
  getText(): string;
  setText(text: string): void;
  hide(): void;
  show(): void;
  /** False once the HUD was closed (or the session ended): nothing must be shown again. */
  alive(): boolean;
  sleep(ms: number): Promise<void>;
  /** Tells the user that any key returns to the HUD and swallows that first key; `onKey` fires then. Returns a function that cancels it. */
  pause(onKey: () => void): () => void;
}

export type RouteError = "no-editor" | "submit-disabled" | "failed";

export interface RouteResult {
  ok: boolean; // the line was submitted
  error?: RouteError;
  detail?: string;
  via: "focused" | "tree" | "none";
  left: boolean; // the command took the focus (a viewer or a dialog) at some point
  paused: boolean; // the output stayed on omp's screen until a key was pressed
  ms: number;
}

/**
 * Hides the HUD, submits `text` through the editor and brings the HUD back. The user's draft is saved and restored.
 * Output rule: when the command took the focus (a viewer, a dialog) the HUD returns by itself once the focus is back;
 * when it did not, its output is in omp's transcript behind the HUD: the HUD stays hidden until a key is pressed.
 * Every path ends with the HUD visible again (unless it was closed meanwhile).
 */
export async function routeThroughEditor(env: RouteEnv, text: string): Promise<RouteResult> {
  const t0 = Date.now();
  const result: RouteResult = { ok: false, via: "none", left: false, paused: false, ms: 0 };
  let hidden = false;
  let draft = "";
  let cancelPause: (() => void) | undefined;
  try {
    draft = env.getText();
    env.hide();
    hidden = true;
    const tui = env.tui();
    const found = findEditor(tui);
    result.via = found.via;
    const editor = found.editor;
    if (!editor) {
      result.error = "no-editor";
      return result;
    }
    if (editor.disableSubmit === true) {
      result.error = "submit-disabled";
      return result;
    }
    env.setText(text);
    editor.submit();
    result.ok = true;
    let keyed = false;
    for (let polls = 1; env.alive(); polls++) {
      await env.sleep(POLL_MS);
      if (keyed || !env.alive()) break;
      if (!editorHasFocus(tui, editor)) {
        result.left = true;
        if (cancelPause) {
          cancelPause();
          cancelPause = undefined;
          result.paused = false;
        }
      } else if (result.left || keyed) break;
      else if (!cancelPause && polls * POLL_MS >= SETTLE_MS) {
        result.paused = true;
        cancelPause = env.pause(() => {
          keyed = true;
          env.show();
        });
      }
      if (keyed) break;
    }
  } catch (e) {
    if (!result.ok) result.error = "failed";
    result.detail = e instanceof Error ? e.message : String(e);
  } finally {
    try {
      cancelPause?.();
    } catch {
      // the status line may already be gone
    }
    if (hidden && env.alive()) {
      try {
        // The submit cleared the editor: put the draft back unless the command itself filled it.
        if (draft !== "" && env.getText() === "") env.setText(draft);
      } catch {
        // the draft is lost, the HUD must still come back
      }
      try {
        env.show();
      } catch (e) {
        result.detail ??= e instanceof Error ? e.message : String(e);
      }
    }
    result.ms = Date.now() - t0;
  }
  return result;
}
