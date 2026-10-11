// Maps omp events onto the HudStore. Every handler is wrapped in try/catch, runs in O(1) and never throws.
// `pi.events` channels are not a documented contract: fields may be missing, everything is read defensively.
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import type { HudStore, HudTask, NodeStatus, TaskStatus } from "./types.ts";
import { chatFromBranch, contentText } from "./chat.ts";
import { MAIN_AGENT, type MsgKey, t } from "./i18n.ts";

type Rec = Record<string, unknown>;

const TASK_STATUSES: Record<string, TaskStatus> = {
  pending: "pending",
  in_progress: "in_progress",
  completed: "completed",
  abandoned: "abandoned",
  blocked: "blocked",
};

const NODE_STATUS_BY_LIFECYCLE: Record<string, NodeStatus> = {
  started: "running",
  completed: "completed",
  failed: "failed",
  aborted: "aborted",
};

const LIFECYCLE_KEY: Record<NodeStatus, MsgKey> = {
  running: "sub.running",
  completed: "sub.completed",
  failed: "sub.failed",
  aborted: "sub.aborted",
};

const FEED_TEXT_MAX = 160;
const CHAT_UPDATE_MS = 125; // streaming text reaches the store at most ~8 times per second
const PENDING_MAX_MS = 3000; // a message sent from the HUD that omp never reported back is dropped once the agent has ended

function rec(v: unknown): Rec | undefined {
  return typeof v === "object" && v !== null ? (v as Rec) : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Single line, short text. */
function oneLine(s: string, max = FEED_TEXT_MAX): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** First text part of a tool result (for error details). */
function resultText(result: unknown): string | undefined {
  const content = rec(result)?.content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content) {
    const text = str(rec(block)?.text);
    if (text) return text;
  }
  return undefined;
}

/** `details.phases` -> flat task list (phase name is kept). undefined when invalid. */
export function flattenPhases(details: unknown): HudTask[] | undefined {
  const phases = rec(details)?.phases;
  if (!Array.isArray(phases)) return undefined;
  const out: HudTask[] = [];
  for (const phase of phases) {
    const p = rec(phase);
    if (!p) continue;
    const phaseName = str(p.name) ?? "";
    const tasks = Array.isArray(p.tasks) ? p.tasks : [];
    for (const task of tasks) {
      const t = rec(task);
      if (!t) continue;
      const item: HudTask = {
        phase: phaseName,
        content: str(t.content) ?? "",
        status: TASK_STATUSES[String(t.status)] ?? "pending",
      };
      const blocker = str(t.blocker);
      if (blocker) item.blocker = blocker;
      out.push(item);
    }
  }
  return out;
}

export function attachCollector(piArg: unknown, store: HudStore): void {
  const pi = piArg as ExtensionAPI;

  // --- main agent local state ---
  const runningTools = new Map<string, string>(); // toolCallId -> tool name
  let streaming = false;
  let msgStartAt = 0;
  let firstUpdateAt = 0;
  let chatId: string | undefined; // the streaming assistant message in the chat panel
  let chatAt = 0;

  // --- subagent tracking ---
  let busSeen = false; // once the pi.events channel works, the ctx.agent fallback path is closed
  const idByIndex = new Map<number, string>();
  let unsubs: Array<() => void> = [];
  let subscribed = false;

  function resetLocal(): void {
    runningTools.clear();
    streaming = false;
    msgStartAt = 0;
    firstUpdateAt = 0;
    chatId = undefined;
    chatAt = 0;
    idByIndex.clear();
  }

  function nodeById(id: string) {
    return store.state.nodes.find((n) => n.id === id);
  }

  // --- pi.events (subagents) ---
  function nodeName(payload: Rec, progress: Rec | undefined, index: number | undefined): string {
    return (
      str(payload.agent) ?? str(progress?.agent) ?? `subagent-${index !== undefined ? index + 1 : store.state.nodes.length + 1}`
    );
  }

  function onLifecycle(raw: unknown): void {
    try {
      const p = rec(raw);
      if (!p) return;
      busSeen = true;
      const status = NODE_STATUS_BY_LIFECYCLE[String(p.status)];
      if (!status) return;
      const index = num(p.index);
      const id = str(p.id) ?? (index !== undefined ? `sub-${index}` : undefined);
      if (!id) return;
      if (index !== undefined) idByIndex.set(index, id);
      const name = nodeName(p, undefined, index);
      const prev = nodeById(id)?.status;
      const patch: Parameters<HudStore["upsertNode"]>[0] = { id, name, status };
      if (status !== "running") {
        patch.currentTool = undefined;
        patch.retrying = undefined;
        if (status === "failed") {
          const err = str(p.error) ?? str(p.message);
          if (err) patch.error = oneLine(err, 200);
        }
      }
      store.upsertNode(patch);
      if (prev !== status) {
        const desc = str(p.description);
        const base = t(LIFECYCLE_KEY[status]);
        store.pushFeed({
          agent: name,
          kind: "subagent",
          text: oneLine(desc && status === "running" ? `${base}: ${desc}` : base),
          ...(status === "failed" ? { error: true } : {}),
        });
      }
    } catch {
      // swallow
    }
  }

  function onProgress(raw: unknown): void {
    try {
      const p = rec(raw);
      if (!p) return;
      busSeen = true;
      const pr = rec(p.progress);
      if (!pr) return;
      const index = num(p.index);
      const id =
        (index !== undefined ? idByIndex.get(index) : undefined) ??
        str(pr.id) ??
        (index !== undefined ? `sub-${index}` : undefined);
      if (!id) return;
      const patch: Parameters<HudStore["upsertNode"]>[0] = { id, name: nodeName(p, pr, index) };
      const tokens = num(pr.tokens);
      if (tokens !== undefined) patch.tokens = tokens;
      const cost = num(pr.cost);
      if (cost !== undefined) patch.cost = cost;
      const ctxTokens = num(pr.contextTokens);
      if (ctxTokens !== undefined) patch.contextTokens = ctxTokens;
      const toolCount = num(pr.toolCount);
      if (toolCount !== undefined) patch.toolCount = toolCount;
      // Snapshot: a missing field = absent.
      patch.currentTool = str(pr.currentTool);
      const intent = str(pr.currentToolIntent) ?? str(pr.lastIntent) ?? str(pr.description);
      if (intent) patch.lastIntent = oneLine(intent, 120);
      patch.retrying = pr.retryState ? true : undefined;
      // A late progress event does not reopen a finished node: status is not set.
      store.upsertNode(patch);
    } catch {
      // swallow
    }
  }

  function ensureBus(): void {
    if (subscribed) return;
    const events = pi.events;
    if (!events || typeof events.on !== "function") return;
    subscribed = true;
    try {
      for (const [channel, fn] of [
        ["task:subagent:lifecycle", onLifecycle],
        ["task:subagent:progress", onProgress],
      ] as const) {
        const off = events.on(channel, fn);
        if (typeof off === "function") unsubs.push(off);
      }
    } catch {
      // channel missing or changed: the fallback path stays active
    }
  }

  function dropBus(): void {
    for (const off of unsubs) {
      try {
        off();
      } catch {
        // swallow
      }
    }
    unsubs = [];
    subscribed = false;
  }

  // --- ctx.agent fallback path (the same handlers in a subagent session) ---
  function subInfo(ctx: ExtensionContext): { id: string; name: string; parentId?: string } | undefined {
    const a = ctx.agent;
    if (!a || a.kind !== "sub") return undefined;
    const id = str(a.id) ?? str(a.name);
    if (!id) return undefined;
    const info: { id: string; name: string; parentId?: string } = { id, name: str(a.name) ?? id };
    if (a.parentId) info.parentId = a.parentId;
    return info;
  }

  /** In a subagent session, handles the fallback path and returns true (skips the main handler). */
  function handleSub(ctx: ExtensionContext, fn: (info: { id: string; name: string; parentId?: string }) => void): boolean {
    if (ctx.agent?.kind !== "sub") return false;
    if (busSeen) return true; // the channel is already feeding
    const info = subInfo(ctx);
    if (info) fn(info);
    return true;
  }

  function main(ctx: ExtensionContext): boolean {
    if (ctx.agent?.kind === "sub") return false;
    ensureBus();
    return true;
  }

  function guard<E>(fn: (event: E, ctx: ExtensionContext) => void): (event: E, ctx: ExtensionContext) => void {
    return (event, ctx) => {
      try {
        fn(event, ctx);
      } catch {
        // a handler never throws
      }
    };
  }

  function refreshContext(ctx: ExtensionContext): void {
    try {
      const u = ctx.getContextUsage();
      const pct = u ? num(u.percent) : undefined;
      if (pct !== undefined) store.setCtxPct(pct);
    } catch {
      // context percentage unknown
    }
  }

  function settleCore(): void {
    if (runningTools.size > 0) {
      const last = [...runningTools.values()].pop();
      store.setCoreStatus("tool", last);
    } else {
      store.setCoreStatus("thinking");
    }
  }

  function rebuildTodos(ctx: ExtensionContext): void {
    try {
      const branch = ctx.sessionManager.getBranch();
      for (let i = branch.length - 1; i >= 0; i--) {
        const m = branch[i]?.message;
        if (m?.toolName !== "todo") continue;
        const tasks = flattenPhases(m.details);
        if (tasks) {
          store.setTasks(tasks);
          return;
        }
      }
    } catch {
      // history could not be read
    }
  }

  function rebuildChat(ctx: ExtensionContext): void {
    try {
      const drafts = chatFromBranch(ctx.sessionManager.getBranch());
      if (drafts.length > 0) store.loadChat(drafts);
    } catch {
      // history could not be read
    }
  }

  /** A user message that omp reports: it either confirms one sent from the HUD or came from the editor. */
  function userChat(message: { content?: unknown } | undefined): void {
    const text = contentText(message?.content).trim();
    if (text === "") return;
    if (!store.resolvePendingChat(text)) store.addChat({ role: "user", text });
  }

  /** Streaming text of the assistant message: at most ~8 updates per second; the chat entry appears with the first text. */
  function updateAssistantChat(message: { content?: unknown } | undefined): void {
    const now = Date.now();
    if (chatId !== undefined && now - chatAt < CHAT_UPDATE_MS) return;
    chatAt = now;
    const text = contentText(message?.content);
    if (text === "") return;
    if (chatId === undefined) chatId = store.addChat({ role: "assistant", text, streaming: true });
    else store.updateChat(chatId, { text });
  }

  /** The finished assistant message: final text, streaming off; a message without text (tool calls only) leaves no trace. */
  function endAssistantChat(message: { content?: unknown } | undefined): void {
    const id = chatId;
    chatId = undefined;
    const text = message ? contentText(message.content) : undefined;
    if (id === undefined) {
      if (text !== undefined && text.trim() !== "") store.addChat({ role: "assistant", text });
      return;
    }
    if (text !== undefined && text.trim() === "") store.removeChat(id);
    else store.updateChat(id, text === undefined ? { streaming: false } : { text, streaming: false });
  }

  // --- session ---
  const onSessionReset = guard<Rec>((_e, ctx) => {
    if (!main(ctx)) return;
    resetLocal();
    store.reset();
    rebuildTodos(ctx);
    rebuildChat(ctx);
  });
  pi.on("session_start", onSessionReset);
  pi.on("session_switch", onSessionReset);
  pi.on(
    "session_shutdown",
    guard((_e, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      dropBus();
    }),
  );

  // --- agent/turn ---
  pi.on(
    "agent_start",
    guard((_e, ctx) => {
      if (
        handleSub(ctx, (s) => {
          store.upsertNode({ id: s.id, name: s.name, parentId: s.parentId, status: "running" });
          store.pushFeed({ agent: s.name, kind: "subagent", text: t("sub.running") });
        })
      )
        return;
      main(ctx);
      streaming = false;
      store.setWarning(undefined);
      store.setCoreStatus("thinking");
    }),
  );

  pi.on(
    "turn_start",
    guard((_e, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      main(ctx);
      streaming = false;
      store.incrementTurn();
      settleCore();
    }),
  );

  pi.on(
    "turn_end",
    guard((_e, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      refreshContext(ctx);
    }),
  );

  pi.on(
    "agent_end",
    guard((event, ctx) => {
      if (
        handleSub(ctx, (s) => {
          const prev = nodeById(s.id)?.status;
          store.upsertNode({ id: s.id, name: s.name, status: "completed", currentTool: undefined });
          if (prev !== "completed") store.pushFeed({ agent: s.name, kind: "subagent", text: t("sub.completed") });
        })
      )
        return;
      main(ctx);
      runningTools.clear();
      streaming = false;
      refreshContext(ctx);
      const messages = rec(event)?.messages;
      let failed = false;
      if (Array.isArray(messages)) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = rec(messages[i]);
          if (m?.role === "assistant") {
            failed = m.stopReason === "error";
            break;
          }
        }
      }
      store.setCoreStatus(failed ? "error" : "done");
      endAssistantChat(undefined);
      store.expirePendingChat(PENDING_MAX_MS);
    }),
  );

  // --- message ---
  pi.on(
    "message_start",
    guard((event, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      const role = event.message?.role;
      if (role === "user") {
        userChat(event.message);
        return;
      }
      if (role !== undefined && role !== "assistant") return;
      streaming = false;
      msgStartAt = Date.now();
      firstUpdateAt = 0;
      chatId = undefined; // the chat message is created when the first text arrives
    }),
  );

  pi.on(
    "message_update",
    guard((event, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      const role = event.message?.role;
      if (role !== undefined && role !== "assistant") return;
      if (role === "assistant") updateAssistantChat(event.message);
      if (streaming) return; // high frequency: only a flag
      streaming = true;
      firstUpdateAt = Date.now();
      if (runningTools.size === 0) store.setCoreStatus("streaming");
    }),
  );

  pi.on(
    "message_end",
    guard((event, ctx) => {
      const message = event.message;
      if (message?.role !== undefined && message.role !== "assistant") return;
      const usage = message?.usage;
      if (
        handleSub(ctx, (s) => {
          const node = nodeById(s.id);
          store.upsertNode({
            id: s.id,
            name: s.name,
            tokens: (node?.tokens ?? 0) + (num(usage?.totalTokens) ?? (num(usage?.input) ?? 0) + (num(usage?.output) ?? 0)),
            cost: (node?.cost ?? 0) + (num(usage?.cost?.total) ?? 0),
          });
        })
      )
        return;
      main(ctx);
      endAssistantChat(message);
      const wasStreaming = streaming;
      streaming = false;
      if (usage) {
        store.addUsage({
          input: num(usage.input),
          output: num(usage.output),
          cacheRead: num(usage.cacheRead),
          cacheWrite: num(usage.cacheWrite),
          cost: num(usage.cost?.total),
        });
        const out = num(usage.output);
        // Real omp: message.duration and message.ttft are in ms; generation time = duration - ttft (verified).
        const m = message as unknown as Rec;
        const gen = (num(m.duration) ?? 0) - (num(m.ttft) ?? 0);
        const from = firstUpdateAt || msgStartAt;
        if (out !== undefined && out > 0) {
          if (gen >= 200) store.setTokPerSec(out / (gen / 1000));
          else if (from > 0) {
            const secs = (Date.now() - from) / 1000;
            if (secs >= 0.05) store.setTokPerSec(out / secs);
          }
        }
      }
      if (wasStreaming && runningTools.size === 0) store.setCoreStatus("thinking");
    }),
  );

  // --- tools ---
  pi.on(
    "tool_execution_start",
    guard((event, ctx) => {
      const name = str(event.toolName) ?? "tool";
      const intent = str(event.intent);
      if (
        handleSub(ctx, (s) => {
          const node = nodeById(s.id);
          store.upsertNode({
            id: s.id,
            name: s.name,
            currentTool: name,
            toolCount: (node?.toolCount ?? 0) + 1,
            ...(intent ? { lastIntent: oneLine(intent, 120) } : {}),
          });
        })
      )
        return;
      main(ctx);
      const id = str(event.toolCallId) ?? `${name}#${runningTools.size}`;
      runningTools.set(id, name);
      streaming = false;
      store.setCoreStatus("tool", name);
      store.pushFeed({ agent: MAIN_AGENT, kind: "tool", text: oneLine(intent ? `${name}: ${intent}` : name) });
    }),
  );

  pi.on(
    "tool_execution_end",
    guard((event, ctx) => {
      const name = str(event.toolName) ?? "tool";
      if (
        handleSub(ctx, (s) => {
          store.upsertNode({ id: s.id, name: s.name, currentTool: undefined });
        })
      )
        return;
      main(ctx);
      const id = str(event.toolCallId);
      if (id) runningTools.delete(id);
      else {
        for (const [k, v] of runningTools) {
          if (v === name) {
            runningTools.delete(k);
            break;
          }
        }
      }
      if (event.isError) {
        const detail = resultText(event.result);
        store.pushFeed({
          agent: MAIN_AGENT,
          kind: "error",
          text: oneLine(`${t("feed.toolError", { name })}${detail ? `: ${detail}` : ""}`),
          error: true,
        });
      } else {
        store.pushFeed({ agent: MAIN_AGENT, kind: "tool", text: t("feed.toolDone", { name }) });
      }
      settleCore();
    }),
  );

  pi.on(
    "tool_result",
    guard((event, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      if (event.toolName !== "todo") return;
      const tasks = flattenPhases(event.details);
      if (!tasks) return;
      const before = store.version;
      store.setTasks(tasks);
      if (store.version !== before) {
        const done = tasks.filter((task) => task.status === "completed").length;
        store.pushFeed({ agent: MAIN_AGENT, kind: "todo", text: t("feed.todoProgress", { done, total: tasks.length }) });
      }
    }),
  );

  // --- reliability signals ---
  pi.on(
    "auto_retry_start",
    guard((event, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      main(ctx);
      const attempt = num(event.attempt);
      const max = num(event.maxAttempts);
      const err = str(event.errorMessage);
      store.setWarning("retry");
      const counter = attempt !== undefined ? ` (${attempt}${max !== undefined ? `/${max}` : ""})` : "";
      store.pushFeed({
        agent: MAIN_AGENT,
        kind: "retry",
        text: oneLine(`${t("feed.retrying")}${counter}${err ? `: ${err}` : ""}`),
      });
    }),
  );

  pi.on(
    "auto_retry_end",
    guard((event, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      if (store.state.core.warning === "retry") store.setWarning(undefined);
      if (event.success === false) {
        const err = str(event.finalError);
        store.pushFeed({
          agent: MAIN_AGENT,
          kind: "retry",
          text: oneLine(`${t("feed.retryFailed")}${err ? `: ${err}` : ""}`),
          error: true,
        });
      }
    }),
  );

  pi.on(
    "retry_fallback_applied",
    guard((event, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      store.setWarning("fallback");
      const from = str(event.from);
      const to = str(event.to);
      store.pushFeed({
        agent: MAIN_AGENT,
        kind: "retry",
        text: oneLine(t("feed.fallback", { from: from ?? "?", to: to ?? "?" })),
      });
    }),
  );

  pi.on(
    "auto_compaction_start",
    guard((_e, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      store.setWarning("compaction");
      store.pushFeed({ agent: MAIN_AGENT, kind: "system", text: t("feed.compacting") });
    }),
  );

  pi.on(
    "auto_compaction_end",
    guard((event, ctx) => {
      if (ctx.agent?.kind === "sub") return;
      if (store.state.core.warning === "compaction") store.setWarning(undefined);
      const err = str(event.errorMessage);
      const failed = Boolean(err) || event.aborted === true;
      store.pushFeed({
        agent: MAIN_AGENT,
        kind: failed ? "error" : "system",
        text: failed ? oneLine(`${t("feed.compactFailed")}${err ? `: ${err}` : ""}`) : t("feed.compacted"),
        ...(failed ? { error: true } : {}),
      });
      refreshContext(ctx);
    }),
  );

}
