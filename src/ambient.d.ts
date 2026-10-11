// Only the surface of omp's compiled-in modules that this extension uses.
// Types are loose but meaningful; node_modules is not required.

declare module "@oh-my-pi/pi-tui" {
  /** Visible (ANSI-free) cell width. */
  export function visibleWidth(text: string): number;
  /** ANSI-aware truncation; when `ellipsis` is omitted the omp default is used. */
  export function truncateToWidth(text: string, maxWidth: number, ellipsis?: string, pad?: boolean): string;
  export function matchesKey(data: string, keyId: string): boolean;
  export function wrapTextWithAnsi(text: string, width: number): string[];

  export interface Component {
    render(width: number): readonly string[];
    handleInput?(data: string): void;
    invalidate?(): void;
    dispose?(): void;
  }

  export interface TUI {
    requestRender(force?: boolean): void;
    /** Terminal; the field is undocumented, callers fall back to 30 when it is missing. */
    terminal?: { rows?: number; columns?: number };
    /** Undocumented: the focused component (the editor when no overlay is visible). */
    getFocused?(): unknown;
    /** Undocumented: true while an overlay is shown (a hidden one does not count). */
    hasOverlay?(): boolean;
    /** Undocumented: child components of the root container. */
    children?: readonly unknown[];
  }
}

declare module "@oh-my-pi/pi-coding-agent" {
  import type { Component, TUI } from "@oh-my-pi/pi-tui";

  export type ThemeColor = string;
  export interface Theme {
    fg(color: ThemeColor, text: string): string;
    bold(text: string): string;
  }
  export const theme: Theme;

  export interface AgentInfo {
    kind: "main" | "sub";
    id?: string;
    name?: string;
    depth?: number;
    parentId?: string;
  }

  export interface ContextUsage {
    tokens: number | null;
    contextWindow: number;
    percent: number | null;
  }

  export interface SessionEntryLike {
    type?: string;
    message?: {
      role?: string;
      toolName?: string;
      details?: unknown;
      content?: unknown;
      timestamp?: number;
    };
    [key: string]: unknown;
  }

  export interface SessionManagerLike {
    getBranch(): SessionEntryLike[];
  }

  export interface OverlayOptions {
    anchor?: string;
    width?: number | string;
    maxHeight?: number | string;
    margin?: number;
    fullscreen?: boolean;
    mouseTracking?: boolean;
  }

  /** Mounted overlay. `setHidden` keeps it on the stack but takes it off the screen and returns the focus to the component below. */
  export interface OverlayHandle {
    hide(): void;
    setHidden(hidden: boolean): void;
    isHidden(): boolean;
  }

  export interface CustomOptions {
    overlay?: boolean;
    overlayOptions?: OverlayOptions;
    /** Receives the mounted overlay handle. */
    onHandle?(handle: OverlayHandle): void;
  }

  export type ComponentFactory<T extends Component = Component> = (tui: TUI, theme: Theme) => T;

  export interface ExtensionUI {
    custom<T = unknown>(
      factory: (tui: TUI, theme: Theme, keybindings: unknown, done: (result: T) => void) => Component,
      options?: CustomOptions,
    ): Promise<T>;
    setWidget(
      key: string,
      content: ComponentFactory | readonly string[] | undefined,
      options?: { placement?: "aboveEditor" | "belowEditor" },
    ): void;
    /** Footer status text keyed per extension; `undefined` removes the entry. omp strips ANSI and truncates it. */
    setStatus(key: string, text: string | undefined): void;
    notify(message: string, type?: "info" | "warning" | "error"): void;
    /** Replaces the text of omp's editor (interactive mode). */
    setEditorText(text: string): void;
    getEditorText(): string;
    /** Wraps omp's autocomplete provider; called again with the current base every time the slash commands refresh. There is no way to remove it. */
    addAutocompleteProvider(factory: (base: unknown) => unknown): void;
    /** Listens to raw terminal input before the focused component; `consume` swallows the key. Returns the unsubscribe function. */
    onTerminalInput(listener: (data: string) => { consume?: boolean; data?: string } | undefined): () => void;
  }

  export interface ExtensionContext {
    ui: ExtensionUI;
    mode?: "tui" | "rpc" | "json" | "print";
    hasUI: boolean;
    cwd: string;
    sessionManager: SessionManagerLike;
    agent?: AgentInfo;
    getContextUsage(): ContextUsage | undefined;
    /** False while the agent is streaming (a turn is running). */
    isIdle(): boolean;
    setInterval(fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]): unknown;
    setTimeout(fn: (...args: unknown[]) => void, ms: number, ...args: unknown[]): unknown;
    clearTimer(timer: unknown): void;
  }

  export type ExtensionCommandContext = ExtensionContext;

  export interface Usage {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    totalTokens?: number;
    cost?: { total?: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  }

  export interface ExtensionEventMap {
    agent_start: Record<string, unknown>;
    agent_end: Record<string, unknown>;
    turn_start: Record<string, unknown>;
    turn_end: Record<string, unknown>;
    message_start: { message?: { role?: string; content?: unknown; timestamp?: number } };
    message_update: { message?: { role?: string; content?: unknown; timestamp?: number } };
    message_end: { message?: { role?: string; content?: unknown; timestamp?: number; usage?: Usage } };
    tool_execution_start: { toolCallId?: string; toolName?: string; args?: unknown; intent?: string };
    tool_execution_end: { toolCallId?: string; toolName?: string; result?: unknown; isError?: boolean };
    tool_result: { toolName?: string; details?: unknown; isError?: boolean };
    auto_retry_start: Record<string, unknown>;
    auto_retry_end: Record<string, unknown>;
    retry_fallback_applied: { from?: string; to?: string };
    auto_compaction_start: Record<string, unknown>;
    auto_compaction_end: Record<string, unknown>;
    session_start: Record<string, unknown>;
    session_switch: Record<string, unknown>;
    session_shutdown: Record<string, unknown>;
  }

  export interface RegisteredCommand {
    description?: string;
    handler(args: string, ctx: ExtensionCommandContext): void | Promise<void>;
  }

  export interface ExtensionEventBus {
    on(channel: string, handler: (payload: unknown) => void): (() => void) | void;
  }

  export interface ExtensionAPI {
    on<K extends keyof ExtensionEventMap>(
      event: K,
      handler: (event: ExtensionEventMap[K], ctx: ExtensionContext) => void | Promise<void>,
    ): void;
    registerCommand(name: string, command: RegisteredCommand): void;
    events?: ExtensionEventBus;
    /** Submits user text without slash-command or template expansion. Omitting `deliverAs` starts a turn when idle (a steer while streaming). */
    sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" | "aside"; attribution?: "user" | "agent" }): void;
  }
}

// Universal surface (declared by hand because of types: []; only what is used).
declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exit(code?: number): never;
  stdout: { write(chunk: string): boolean; columns?: number; rows?: number };
};
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
declare const Bun: {
  plugin(plugin: {
    name: string;
    setup(build: {
      module(specifier: string, factory: () => { exports: Record<string, unknown>; loader: "object" }): void;
    }): void;
  }): void;
};
declare function setTimeout(fn: () => void, ms?: number): unknown;
declare class AbortSignal {
  readonly aborted: boolean;
}
declare class AbortController {
  readonly signal: AbortSignal;
  abort(): void;
}
