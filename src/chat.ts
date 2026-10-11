// Conversation state shared by the store, the collector and the full-screen chat panel: types, text hygiene, history loading.
// Nothing here renders anything or talks to omp.

export const CHAT_MAX = 40; // ring buffer length (messages)
export const CHAT_TEXT_MAX = 12 * 1024; // characters kept per message
export const CHAT_HISTORY_LOAD = 40; // messages read from the session branch at session start

export type ChatRole = "user" | "assistant" | "system";

/** `steer`: delivered at the agent's next step (omp "Steering"); `after`: waits until the agent yields (omp "After yield"); `sending`: the agent was idle, the turn is starting. */
export type ChatPending = "steer" | "after" | "sending";

/** How the prompt sends a line: `steer` (Enter) is what the omp editor's Enter does (a prompt when idle, a steer while busy); `after` (Alt+Enter) waits for the agent to yield. */
export type SendMode = "steer" | "after";

export interface ChatMessage {
  id: string;
  role: ChatRole; // `system` = a local notice of the HUD itself (command output); it is not part of the omp transcript
  text: string; // sanitized and clipped, see sanitizeChatText / clipChatText
  t: number; // ms epoch
  streaming: boolean; // an assistant message that is still being written
  pending?: ChatPending; // a user message sent from the HUD that omp has not reported back yet
  rev: number; // bumped on every text change; keys the wrapped-line cache of the renderer
}

/** What the HUD feeds into the store; `id`, `t`, `rev` and `streaming` get defaults. */
export interface ChatDraft {
  role: ChatRole;
  text: string;
  id?: string;
  t?: number;
  streaming?: boolean;
  pending?: ChatPending;
}

/** Scroll state of the conversation panel. The renderer reads `offset`/`follow` and writes `max`/`page` back. */
export interface ChatView {
  follow: boolean; // stuck to the newest line
  offset: number; // wrapped lines scrolled up from the bottom (0 = bottom)
  max: number; // largest valid offset, written by the renderer
  page: number; // visible rows of the panel, written by the renderer (PageUp/PageDown step)
  lastTotal: number; // total wrapped lines at the previous render (keeps the view still while new text arrives)
  width: number; // panel width at the previous render (0 = not rendered yet): a change re-wraps every message
  anchor?: { id: string; frac: number }; // the line at the bottom of a scrolled view: its message and how far into it (0..1)
  cache: Map<string, { key: string; lines: string[] }>; // wrapped lines per message id
}

export function newChatView(): ChatView {
  return { follow: true, offset: 0, max: 0, page: 10, lastTotal: 0, width: 0, cache: new Map() };
}

/** What the full-screen HUD can do with a line typed into its prompt; implemented by the extension entry (or the demo). */
export interface ChatBridge {
  /** Plain text for the agent; `mode` only matters while the agent is busy (idle: a normal prompt). */
  send(text: string, mode: SendMode): void;
  /** The arguments of a `/hud ...` line (everything after `/hud`), run locally; its output goes into the conversation panel. */
  command(args: string): void;
}

const ANSI_CSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
const ANSI_OTHER = /\x1b[@-Z\\-_]?/g;
// C0 controls except \n and \t, DEL, C1 controls, bidi overrides/isolates, BOM.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\ufeff]/g;

/** Plain text that can never move the cursor or restyle the terminal: ANSI sequences and control characters are removed. */
export function sanitizeChatText(raw: string): string {
  return raw
    .replace(ANSI_OSC, "")
    .replace(ANSI_CSI, "")
    .replace(ANSI_OTHER, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(CONTROL, "");
}

/** Keeps the head and the tail of a very long text (the tail is what a live stream shows). */
export function clipChatText(text: string, max = CHAT_TEXT_MAX): string {
  if (text.length <= max) return text;
  const head = Math.floor(max / 4);
  return `${text.slice(0, head)}\n…\n${text.slice(text.length - (max - head - 3))}`;
}

/** Sanitized and clipped. Texts far beyond the cap are cut first so that a huge stream stays cheap to clean at every update. */
export function cleanChatText(raw: string): string {
  const bounded = raw.length > CHAT_TEXT_MAX * 4 ? `${raw.slice(0, CHAT_TEXT_MAX)}\n${raw.slice(raw.length - CHAT_TEXT_MAX * 3)}` : raw;
  return clipChatText(sanitizeChatText(bounded));
}

/** Comparable form of a message text (pending matching): whitespace collapsed. */
export function matchKey(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function rec(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : undefined;
}

/** Text of an omp message `content` (a string or an array of blocks): only `text` blocks, never `thinking` or tool calls. */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    const b = rec(block);
    if (b?.type === "text" && typeof b.text === "string" && b.text !== "") parts.push(b.text);
  }
  return parts.join("\n\n");
}

/** The last `limit` user/assistant messages with text from `getBranch()` entries, oldest first. */
export function chatFromBranch(branch: readonly unknown[], limit = CHAT_HISTORY_LOAD): ChatDraft[] {
  const out: ChatDraft[] = [];
  for (let i = branch.length - 1; i >= 0 && out.length < limit; i--) {
    const entry = rec(branch[i]);
    if (!entry || entry.type !== "message") continue;
    const m = rec(entry.message);
    const role = m?.role;
    if (role !== "user" && role !== "assistant") continue;
    const text = contentText(m?.content).trim();
    if (text === "") continue;
    const ts = typeof m?.timestamp === "number" && Number.isFinite(m.timestamp) ? m.timestamp : undefined;
    out.push({ role, text, ...(ts !== undefined ? { t: ts } : {}) });
  }
  return out.reverse();
}
