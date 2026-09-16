/**
 * Reduces the `agent` SSE frames into a tree of activity items for AgentActivityLog.
 * Framework-free (a tiny external store) so it can be unit-tested and consumed through
 * `useSyncExternalStore`. Notifications are coalesced per animation frame because text
 * deltas arrive at high frequency.
 */
import type { AgentActivityEvent } from "@/lib/contracts";

export type ActivityItem =
  | { kind: "init"; id: string; model: string; tools: string[] }
  | { kind: "text"; id: string; raw: string; parent: string | null; final: boolean }
  | { kind: "thinking"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: unknown;
      inputJson: string;
      result: string | null;
      isError: boolean;
      done: boolean;
      parent: string | null;
      subagent: { agent: string; description: string; ended: boolean } | null;
      children: ActivityItem[];
      startedAt: number;
      endedAt: number | null;
    }
  | { kind: "result"; id: string; ok: boolean; costUsd?: number; turns?: number; durationMs?: number; error?: string }
  | { kind: "stderr"; id: string; text: string }
  | { kind: "error"; id: string; message: string; hint?: string };

export interface ActivitySnapshot {
  version: number;
  items: ActivityItem[];
  /** true while the assistant is inside a <<<DOC … DOC>>> block (document being typed) */
  inDoc: boolean;
  toolCount: number;
  lastEventAt: number | null;
}

const DOC_OPEN = "<<<DOC";
const DOC_CLOSE = "DOC>>>";

/**
 * Strip `<<<DOC … DOC>>>` segments from streamed assistant text (the document itself is
 * shown in the editor, not the log). An unterminated `<<<DOC` hides everything after it.
 */
export function stripDocBlocks(raw: string, startInDoc = false): { visible: string; inDoc: boolean } {
  let out = "";
  let i = 0;
  let inDoc = startInDoc;
  while (i < raw.length) {
    if (!inDoc) {
      const o = raw.indexOf(DOC_OPEN, i);
      if (o < 0) {
        out += raw.slice(i);
        break;
      }
      out += raw.slice(i, o);
      i = o + DOC_OPEN.length;
      inDoc = true;
    } else {
      const c = raw.indexOf(DOC_CLOSE, i);
      if (c < 0) break;
      i = c + DOC_CLOSE.length;
      inDoc = false;
    }
  }
  return { visible: out, inDoc };
}

type Listener = () => void;

export class ActivityStore {
  private items: ActivityItem[] = [];
  private byId = new Map<string, ActivityItem>();
  private version = 0;
  private listeners = new Set<Listener>();
  private snapshot: ActivitySnapshot = { version: 0, items: [], inDoc: false, toolCount: 0, lastEventAt: null };
  private dirty = false;
  private scheduled = false;
  private seq = 0;
  private toolCount = 0;
  private lastEventAt: number | null = null;
  /** the text item currently receiving deltas, per parent ("" = top level) */
  private openText = new Map<string, Extract<ActivityItem, { kind: "text" }>>();
  private openThinking: Extract<ActivityItem, { kind: "thinking" }> | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  getSnapshot = (): ActivitySnapshot => this.snapshot;

  reset(): void {
    this.items = [];
    this.byId.clear();
    this.openText.clear();
    this.toolCount = 0;
    this.lastEventAt = null;
    this.publish(true);
  }

  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  private container(parent: string | null | undefined): ActivityItem[] {
    if (parent) {
      const p = this.byId.get(parent);
      if (p && p.kind === "tool") return p.children;
    }
    return this.items;
  }

  private add(item: ActivityItem, parent: string | null | undefined): void {
    this.container(parent).push(item);
    this.byId.set(item.id, item);
  }

  push(ev: AgentActivityEvent, at: number = Date.now()): void {
    if (ev.type !== "thinking") this.openThinking = null;
    this.lastEventAt = at;
    switch (ev.type) {
      case "init":
        this.add({ kind: "init", id: this.nextId("init"), model: ev.model, tools: ev.tools }, null);
        break;
      case "text.delta": {
        const key = ev.parentToolUseId ?? "";
        let item = this.openText.get(key);
        if (!item) {
          item = { kind: "text", id: this.nextId("text"), raw: "", parent: ev.parentToolUseId ?? null, final: false };
          this.openText.set(key, item);
          this.add(item, ev.parentToolUseId);
        }
        item.raw += ev.text;
        break;
      }
      case "assistant.text": {
        const key = ev.parentToolUseId ?? "";
        const item = this.openText.get(key);
        if (item) {
          // the full message supersedes the streamed deltas
          item.raw = ev.text;
          item.final = true;
          this.openText.delete(key);
        } else {
          this.add({ kind: "text", id: this.nextId("text"), raw: ev.text, parent: ev.parentToolUseId ?? null, final: true }, ev.parentToolUseId);
        }
        break;
      }
      case "thinking": {
        // thinking arrives as a stream of small deltas (a few characters each) — append to the
        // open thinking item instead of one entry per delta, which read as one word per line
        if (this.openThinking) this.openThinking.text += ev.text;
        else {
          this.openThinking = { kind: "thinking", id: this.nextId("think"), text: ev.text };
          this.add(this.openThinking, null);
        }
        break;
      }
      case "tool.start": {
        // a tool call ends the current text segment at that level
        this.openText.delete(ev.parentToolUseId ?? "");
        this.toolCount += 1;
        const existing = this.byId.get(ev.toolUseId);
        if (existing && existing.kind === "tool") {
          existing.name = ev.name;
          existing.input = ev.input;
          break;
        }
        this.add(
          {
            kind: "tool",
            id: ev.toolUseId,
            name: ev.name,
            input: ev.input,
            inputJson: ev.input === undefined ? "" : safeJson(ev.input),
            result: null,
            isError: false,
            done: false,
            parent: ev.parentToolUseId ?? null,
            subagent: null,
            children: [],
            startedAt: at,
            endedAt: null,
          },
          ev.parentToolUseId,
        );
        break;
      }
      case "tool.input.delta": {
        const t = this.byId.get(ev.toolUseId);
        if (t && t.kind === "tool") {
          t.inputJson += ev.json;
          try {
            t.input = JSON.parse(t.inputJson);
          } catch {
            /* partial JSON — keep the previous parsed input */
          }
        }
        break;
      }
      case "tool.input": {
        // the complete parsed input (after any deltas)
        const t = this.byId.get(ev.toolUseId);
        if (t && t.kind === "tool") {
          t.name = ev.name || t.name;
          t.input = ev.input;
          t.inputJson = safeJson(ev.input);
        } else {
          this.toolCount += 1;
          this.add(
            {
              kind: "tool",
              id: ev.toolUseId,
              name: ev.name,
              input: ev.input,
              inputJson: safeJson(ev.input),
              result: null,
              isError: false,
              done: false,
              parent: ev.parentToolUseId ?? null,
              subagent: null,
              children: [],
              startedAt: at,
              endedAt: null,
            },
            ev.parentToolUseId,
          );
        }
        break;
      }
      case "tool.result": {
        let t = this.byId.get(ev.toolUseId);
        if (!t || t.kind !== "tool") {
          const placeholder: ActivityItem = {
            kind: "tool",
            id: ev.toolUseId,
            name: ev.name ?? "tool",
            input: undefined,
            inputJson: "",
            result: null,
            isError: false,
            done: false,
            parent: ev.parentToolUseId ?? null,
            subagent: null,
            children: [],
            startedAt: at,
            endedAt: null,
          };
          this.add(placeholder, ev.parentToolUseId);
          t = placeholder;
        }
        if (t.kind === "tool") {
          t.result = ev.content;
          t.isError = ev.isError;
          t.done = true;
          t.endedAt = at;
          if (t.subagent) t.subagent.ended = true;
        }
        // whatever text follows starts a new segment
        this.openText.delete(ev.parentToolUseId ?? "");
        break;
      }
      case "subagent.start": {
        const t = this.byId.get(ev.toolUseId);
        if (t && t.kind === "tool") t.subagent = { agent: ev.agent, description: ev.description, ended: false };
        else
          this.add(
            {
              kind: "tool",
              id: ev.toolUseId,
              name: "Task",
              input: { description: ev.description },
              inputJson: "",
              result: null,
              isError: false,
              done: false,
              parent: null,
              subagent: { agent: ev.agent, description: ev.description, ended: false },
              children: [],
              startedAt: at,
              endedAt: null,
            },
            null,
          );
        break;
      }
      case "subagent.end": {
        const t = this.byId.get(ev.toolUseId);
        if (t && t.kind === "tool" && t.subagent) t.subagent.ended = true;
        break;
      }
      case "result":
        this.openText.clear();
        this.add({ kind: "result", id: this.nextId("result"), ok: ev.ok, costUsd: ev.costUsd, turns: ev.turns, durationMs: ev.durationMs, error: ev.error }, null);
        break;
      case "stderr":
        this.add({ kind: "stderr", id: this.nextId("stderr"), text: ev.text }, null);
        break;
      case "error":
        this.add({ kind: "error", id: this.nextId("error"), message: ev.message, hint: ev.hint }, null);
        break;
    }
    this.publish(false);
  }

  /** publish a new snapshot (coalesced to one per frame unless `now`) */
  private publish(now: boolean): void {
    this.dirty = true;
    if (now) {
      this.flushSnapshot();
      return;
    }
    if (this.scheduled) return;
    this.scheduled = true;
    const run = () => {
      this.scheduled = false;
      this.flushSnapshot();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  flushSnapshot(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.version += 1;
    const top = this.openText.get("");
    const inDoc = top ? stripDocBlocks(top.raw).inDoc : false;
    // items are mutated in place; the snapshot object identity changes so React re-renders
    this.snapshot = { version: this.version, items: this.items, inDoc, toolCount: this.toolCount, lastEventAt: this.lastEventAt };
    for (const l of this.listeners) l();
  }
}

function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/** short human label for a tool call chip */
export function toolSummary(name: string, input: unknown): { label: string; detail: string } {
  const i = (input ?? {}) as Record<string, unknown>;
  const s = (k: string) => (typeof i[k] === "string" ? (i[k] as string) : "");
  switch (name) {
    case "WebSearch":
      return { label: "웹 검색", detail: s("query") };
    case "WebFetch":
      return { label: "웹 페이지", detail: s("url") };
    case "Read":
      return { label: "읽기", detail: s("file_path") || s("path") };
    case "Write":
      return { label: "쓰기", detail: s("file_path") || s("path") };
    case "Edit":
    case "MultiEdit":
      return { label: "수정", detail: s("file_path") };
    case "Glob":
      return { label: "파일 찾기", detail: s("pattern") };
    case "Grep":
      return { label: "검색", detail: s("pattern") };
    case "Bash":
      return { label: "명령", detail: s("command").slice(0, 120) };
    case "Task":
      return { label: "하위 에이전트", detail: s("description") || s("subagent_type") };
    case "TodoWrite":
      return { label: "할 일", detail: "" };
    default:
      return { label: name, detail: s("query") || s("url") || s("file_path") || s("description") || "" };
  }
}
