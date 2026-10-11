// Text helpers shared by the orbit scenes (dock scene and full-screen scene). Pure.
import type { CoreStatus, HudState } from "../types.ts";
import { type MsgKey, t } from "../i18n.ts";

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

/** Single-cell width guarantee: anything outside Latin-1/Latin Extended-A becomes `?`; control characters are dropped. */
export function cleanLabel(name: string, max: number): string {
  let out = "";
  for (let i = 0; i < name.length && out.length < max; i++) {
    const code = name.charCodeAt(i);
    if (code < 32 || code === 127) continue;
    out += code < 0x250 ? name[i] : "?";
  }
  return out;
}

const TOOL_NAME_MAX = 10;

/** Core status as one short phrase (`tool: grep` while a tool runs). */
export function statusLine(state: HudState): string {
  if (state.core.status === "tool" && state.core.activeTool) return t("status.toolNamed", { name: cleanLabel(state.core.activeTool, TOOL_NAME_MAX) });
  return t(STATUS_KEY[state.core.status] ?? "status.idle");
}

/** ` · retrying` style suffix for an active warning, empty without one. */
export function warningSuffix(state: HudState): string {
  return state.core.warning ? ` · ${t(WARNING_KEY[state.core.warning])}` : "";
}
