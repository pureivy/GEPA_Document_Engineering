"use client";
/**
 * ResearchPane — the 조사 stage has no DocModel. While a run is active the assistant text
 * stream is shown as it arrives; afterwards the saved `research/notes.md` is rendered.
 * A tiny markdown renderer (headings, lists, bold, links, code) keeps the bundle dependency-free.
 */
import { Fragment, useEffect, useMemo, useRef, type ReactNode } from "react";

function inline(text: string, key: number): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) parts.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("`")) parts.push(<code key={`${key}-${i++}`} className="rounded bg-slate-100 px-1 font-mono text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(t);
      parts.push(
        <a key={`${key}-${i++}`} href={mm?.[2]} target="_blank" rel="noreferrer" className="text-sky-700 underline">
          {mm?.[1]}
        </a>,
      );
    } else
      parts.push(
        <a key={`${key}-${i++}`} href={t} target="_blank" rel="noreferrer" className="break-all text-sky-700 underline">
          {t}
        </a>,
      );
    last = m.index + t.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <Fragment key={key}>{parts}</Fragment>;
}

export function renderMarkdown(md: string): ReactNode[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded bg-slate-100 p-2 font-mono text-[11px] leading-relaxed">
          {buf.join("\n")}
        </pre>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = level === 1 ? "mt-4 text-lg font-bold" : level === 2 ? "mt-4 text-base font-bold" : "mt-3 text-sm font-semibold";
      out.push(
        <div key={key++} className={`${cls} text-slate-900`}>
          {inline(h[2], key)}
        </div>,
      );
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        const m = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i])!;
        const indent = Math.min(4, Math.floor(m[1].length / 2));
        items.push(
          <li key={key++} style={{ marginLeft: indent * 14 }} className="list-disc">
            {inline(m[3], key)}
          </li>,
        );
        i++;
      }
      out.push(
        <ul key={key++} className="my-1 ml-5 space-y-0.5">
          {items}
        </ul>,
      );
      continue;
    }
    if (/^\s*\|/.test(line)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      out.push(
        <table key={key++} className="my-2 w-full border-collapse text-[12px]">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className={ri === 0 ? "bg-slate-100 font-semibold" : ""}>
                {r.map((c, ci) => (
                  <td key={ci} className="border border-slate-200 px-2 py-1 align-top">
                    {inline(c, key * 100 + ci)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      out.push(
        <blockquote key={key++} className="my-1 border-l-2 border-slate-300 pl-3 text-slate-600">
          {inline(line.replace(/^\s*>\s?/, ""), key)}
        </blockquote>,
      );
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push(<hr key={key++} className="my-3 border-slate-200" />);
      i++;
      continue;
    }
    out.push(
      <p key={key++} className="my-1">
        {inline(line, key)}
      </p>,
    );
    i++;
  }
  return out;
}

export interface ResearchPaneProps {
  /** streamed assistant text while running */
  liveText: string;
  /** saved notes.md (after the run / on load) */
  markdown: string | null;
  running: boolean;
  loading: boolean;
  error: string | null;
}

export function ResearchPane({ liveText, markdown, running, loading, error }: ResearchPaneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const showLive = running || (!markdown && liveText);
  const body = useMemo(() => renderMarkdown(showLive ? liveText : (markdown ?? "")), [showLive, liveText, markdown]);

  useEffect(() => {
    if (running && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [liveText, running]);

  return (
    <div ref={ref} className="h-full overflow-y-auto bg-slate-100 p-6">
      <div className="mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white px-8 py-6 text-[13px] leading-relaxed text-slate-800 shadow-sm">
        <div className="mb-3 flex items-center justify-between border-b border-slate-100 pb-2">
          <div className="text-xs font-semibold text-slate-500">research/notes.md</div>
          {running ? <span className="text-[11px] text-sky-700">작성 중…</span> : null}
        </div>
        {error ? <div className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</div> : null}
        {loading ? <div className="text-xs text-slate-400">불러오는 중…</div> : null}
        {!loading && !error && body.length === 0 ? <div className="py-10 text-center text-xs text-slate-400">{running ? "에이전트의 출력이 도착하면 여기에 표시됩니다." : "아직 조사 노트가 없습니다. ‘실행’을 눌러 조사를 시작하세요."}</div> : null}
        {body}
        {running ? <span className="hwp-caret" /> : null}
      </div>
    </div>
  );
}
