// Dock-only strings (tr + en). Shared words (status, node states, tokens, feed) come from i18n.ts; only the language is read from there.
// `en` is typed against the `tr` keys, so a missing translation is a compile error.
import { getLang } from "./i18n.ts";

const tr = {
  "dock.waiting": "olay bekleniyor…",
  "dock.noTasks": "görev yok",
  "dock.allDone": "hepsi tamam",
  "dock.nextTask": "sıradaki",
  "dock.blocked": "engelli",
  "dock.ctx": "bağlam",
} as const;

const en: Record<keyof typeof tr, string> = {
  "dock.waiting": "waiting for events…",
  "dock.noTasks": "no tasks",
  "dock.allDone": "all done",
  "dock.nextTask": "next",
  "dock.blocked": "blocked",
  "dock.ctx": "ctx",
};

export type DockKey = keyof typeof tr;

const CATALOG = { tr, en } as const;

/** Looks up `key` in the active language (the one i18n.ts reports); `{name}` placeholders are replaced from `params`. */
export function dt(key: DockKey, params?: Readonly<Record<string, string | number>>): string {
  const s = CATALOG[getLang()][key];
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = params[k];
    return v === undefined ? m : String(v);
  });
}
