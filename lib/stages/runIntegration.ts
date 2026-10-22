/**
 * Wires a stage run to the document pipeline:
 *   Write(<stage>/draft.dsl.md) tool.input.delta ─▶ WriteStreamDecoder ─▶ streaming DSL parser ─▶ `doc` SSE frames
 *   (fallback) agent text.delta ─▶ DocExtractor (<<<DOC … DOC>>>) ─▶ same parser
 *   run end ─▶ authoritative DSL (the file the agent wrote, else the final assistant text) ─▶ save version
 *            ─▶ build HWPX + validate + render ─▶ `doc.final` / `export` frames
 * Research runs stream `research/notes.md` content instead of a DocModel.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { DocExtractor, extractDocFromText } from "../agents/docExtractor";
import { WriteStreamDecoder } from "../agents/writeStream";
import { getRunManager, type StartRunInput } from "../agents/runManager";
import type { AgentEvent } from "../agents/runner";
import { createStreamingParser } from "../docmodel/dsl";
import { buildStagePrompt, type StagePromptInput } from "../agents/prompts";
import { limitsFor, modelFor } from "../agents/limits";
import { callableDataGoKrServices, researchDataSourcesStatus } from "../research/dataSources";
import { writeResearchMcpConfig } from "../research/mcpConfig";
import { RESEARCH_MCP_TOOL_IDS } from "../research/tools/register";
import { syncWikiSnapshot, wikiSnapshotDir } from "../research/wikiSnapshot";
import { dataDir, exportStage, saveStageDsl, stageDir } from "./service";
import { isDocStage, type ProjectDTO, type Stage } from "../contracts";
import { writeLedgerSummary } from "../closeout/store";
import { collectWebMaterials } from "../closeout/webMaterials";
import { awaitScans } from "../closeout/scanPdf";

/** 올린 자료를 읽는 단계 — 스캔 PDF 글자 인식이 끝난 뒤에 시작한다 */
export const SCAN_STAGES: ReadonlySet<string> = new Set(["ledger", "analysis", "result", "settlement"]);
import { stagesOf, type ProjectKind } from "../kinds";

export interface StartStageRunOptions {
  project: ProjectDTO;
  stage: Stage | "review";
  reviewTarget?: Stage;
  instruction?: string;
  resumeSessionId?: string;
  /** per-run model override (alias); otherwise the stage default from STAGE_MODELS / env */
  model?: string;
  runner?: StartRunInput["runner"];
  /**
   * When the run succeeds, start the next pipeline stage automatically
   * (research → plan → notice → press) with the stage's default model (user request 2026-09-16).
   */
  autoChain?: boolean;
  /** plan stage: allow 보충 조사 (Task/WebSearch/WebFetch), propagated along an auto-chain */
  supplementalResearch?: boolean;
  /** ledger: 이 실행이 검증 오류를 고치라는 자동 재실행인가(한 번만 돈다 — 무한 반복 방지) */
  ledgerAutoFix?: boolean;
  /** 문서 단계: 이 실행이 내보내기 경고를 고치라는 자동 다듬기인가(한 번만 돈다 — 무한 반복 방지) */
  docAutoFix?: boolean;
}

/**
 * 에이전트가 고칠 수 있는 내보내기 경고 — 편람 표기·문장(참고 등급 제외), 장·절 쪽 나눔, 원장과 다른 금액.
 * 렌더 실패·미리보기 같은 시스템 경고는 에이전트가 고칠 수 없어 뺀다.
 */
// 참고 등급 가운데 '항목 하나'는 담당자가 남은 경고로 손을 대야 했다 — ㅇ 아래 `-` 하나는 이어 쓸지·뺄지 판단이 필요해
// 자동 정리(govNormalize 는 `-` 아래 `·` 하나만 잇는다)가 아니라 다듬기에 넘긴다(결과보고서 ⑥ 맞춤형, 2026-10-22)
export function fixableWarnings(warnings: string[]): string[] {
  return warnings.filter((w) => (w.startsWith("[편람·") && !w.startsWith("[편람·참고")) || w.startsWith("[편람·참고·항목 하나]") || w.startsWith("[쪽 나눔]") || w.startsWith("[정산·금액 대조]") || w.startsWith("[전년 문장]"));
}

/** 자동 다듬기 지시 — 경고 목록 + 대원칙(고치려고 필요한 내용을 빼지 않는다) */
export function docAutoFixInstruction(stage: string, warnings: string[]): string {
  const list = warnings.slice(0, 20);
  return [
    `[자동 다듬기] 프로그램이 ${stage}/draft.dsl.md 를 한글 파일로 내보내 보니 아래 문제가 있다. 원고를 Edit 로 고친다(처음부터 다시 쓰지 않는다).`,
    "대원칙: 간결하게, 꼭 필요한 것은 빼지 않고 없어야 할 것은 넣지 않는다. 경고를 없애려고 계획 대비 실적·성과 같은 핵심을 빼지 않는다 — 줄일 것은 근거 문서번호·되풀이·경위·행정 세부다.",
    `- ${list.join("\n- ")}`,
    ...(warnings.length > list.length ? [`(그 밖에 ${warnings.length - list.length}건 — 같은 종류면 함께 고친다)`] : []),
  ].join("\n");
}

/**
 * 자동연쇄의 다음 단계. 연쇄는 **프로젝트 종류의 단계 목록**을 따른다(진실의 출처는 lib/kinds.ts 하나뿐).
 * 단일 단계 kind(공문)에서는 언제나 null 이므로 연쇄가 아예 돌지 않는다. `review` 도 목록에 없어 null 이다.
 */
export function nextStage(stage: Stage | "review", kind: ProjectKind): Stage | null {
  const chain = stagesOf(kind);
  const i = chain.indexOf(stage as Stage);
  return i >= 0 && i + 1 < chain.length ? chain[i + 1] : null;
}

/**
 * 단계를 시작하기 전에 플랫폼이 준비할 것. 성과 분석은 홈페이지(gepa.kr) 보도자료·행사사진을 자료함에 받아 둔다 —
 * 에이전트에게 웹 도구를 주지 않고도(사진은 파일로 있어야 사진 대지에 넣을 수 있다) 홈페이지 자료를 쓰게 한다.
 * 이어서 수정(resume)에는 다시 받지 않는다. 실패해도 단계는 시작한다.
 * 자료를 읽는 정산·결과보고 단계는 스캔 PDF 글자 인식(scanPdf.ts)이 끝나기를 기다린다 — 실행 버튼(route)은 남은 인식이 있으면
 * 미리 409 로 돌려보내므로 여기서 오래 기다리는 것은 자동으로 이어지는 단계(chainNext)뿐이다.
 */
export async function prepareStage(project: ProjectDTO, stage: Stage | "review", resume = false): Promise<void> {
  if (project.kind === "closeout" && SCAN_STAGES.has(stage)) {
    const n = await awaitScans(project.id).catch((e) => (console.error("[runIntegration] 글자 인식 실패:", e), 0));
    if (n) console.log(`[runIntegration] 스캔 PDF ${n}개 글자 인식`);
  }
  if (stage !== "analysis" || resume) return;
  // 홈페이지가 느려도 실행 버튼이 오래 묶이지 않게 90초에서 끊는다
  const r = await Promise.race([collectWebMaterials(project.id, project.title), new Promise<{ posts: []; error: string }>((ok) => setTimeout(() => ok({ posts: [], error: "90초 안에 끝나지 않아 건너뜀" }), 90_000))]);
  if (r.error) console.error("[runIntegration] gepa.kr 자료 수집 실패:", r.error);
  else if (!("skipped" in r && r.skipped)) console.log(`[runIntegration] gepa.kr 자료 ${r.posts.length}건 수집`);
}

/** The MCP tool ids that will actually work with the configured keys (for the prompt). */
function availableDataTools(env: Record<string, string | undefined> = process.env): string[] {
  const st = researchDataSourcesStatus(env);
  const ids = new Set(callableDataGoKrServices(env).map((s) => s.id));
  const byTool: Record<string, boolean> = {
    data_sources_status: true,
    customs_trade: ["15101643", "15134343", "15101612", "15100475", "15101609"].some((id) => ids.has(id)),
    store_stats: ids.has("15012005"),
    store_upjong_codes: ids.has("15012005"),
    policy_news_search: ids.has("15095335"),
    kotra_country_info: ids.has("15034830"),
    kotra_prices: ids.has("15122665"),
    factory_search: ids.has("15087611"),
    region_population: ids.has("15107303"),
    kosis_search: st.kosis,
    kosis_table: st.kosis,
    law_search: st.law,
    law_text: st.law,
    bizinfo_search: st.bizinfo,
  };
  return RESEARCH_MCP_TOOL_IDS.filter((full) => byTool[full.replace(/^mcp__[^_]+(?:-[^_]+)*__/, "")]);
}

export function startStageRun(opts: StartStageRunOptions): { runId: string; sessionId: string } {
  const rm = getRunManager();
  const workspaceDir = dirname(stageDir(opts.project.id, "research"));
  const researchCapable = opts.stage === "research" || opts.stage === "plan";
  /**
   * 업무보고는 **밖을 조사하지 않고 안을 읽는다.** 실적·전년 대비는 웹이 아니라 진흥원
   * 내부자료에 있으므로 공공데이터 MCP 는 주지 않고 위키만 붙인다(도구도 Read·Grep 뿐이라
   * 웹으로 나갈 길이 없다). 이것이 없으면 에이전트는 위키가 있다는 사실조차 모르고,
   * "비교 기준이 있으면 쓴다"는 규칙이 영원히 발동하지 않는다(user 2026-09-22).
   */
  // 성과 분석도 위키를 읽는다 — 같은 사업의 전년도 실적이 있어야 전년 대비와 차년도 반영사항을 근거 있게 쓴다
  const wikiCapable = researchCapable || opts.stage === "report" || opts.stage === "analysis";
  // public-data MCP server + read-only wiki snapshot for the stages that research
  let mcpConfigPath: string | undefined;
  let wikiDir: string | undefined;
  if (researchCapable) {
    mcpConfigPath = writeResearchMcpConfig({ dir: join(dataDir(), "mcp") }) ?? undefined;
  }
  if (wikiCapable) {
    const wikiSrc = process.env.GEPA_WIKI_DIR?.trim();
    if (wikiSrc) {
      try {
        const r = syncWikiSnapshot(wikiSrc, wikiSnapshotDir(dataDir()));
        wikiDir = r.dir;
        if (r.copied || r.removed) console.log(`[runIntegration] wiki snapshot: ${r.copied}/${r.total} updated, ${r.removed} removed`);
      } catch (e) {
        console.error("[runIntegration] wiki snapshot failed:", (e as Error).message);
      }
    }
  }
  const dataTools = mcpConfigPath ? availableDataTools() : undefined;
  const input: StagePromptInput = { stage: opts.stage, project: opts.project, workspaceDir, instruction: opts.instruction, reviewTarget: opts.reviewTarget, dataTools, wikiDir, supplementalResearch: opts.supplementalResearch };
  const p = buildStagePrompt(input);
  const limits = limitsFor(opts.stage);
  const isDoc = isDocStage(opts.stage);
  const docStage = opts.stage as Stage;

  // live extraction state (per run)
  const extractor = new DocExtractor();
  let parser = createStreamingParser();
  let runId = "";
  let lastAssistantText = "";
  let sawDocOpen = false;
  const publish = (data: { type: string } & Record<string, unknown>) => rm.publish(runId, data);
  let docSeq = 0;
  let docOpen = false;
  const openDoc = () => {
    if (docOpen) endDoc(); // a new Write before the previous stream was closed
    sawDocOpen = true;
    docSeq += 1;
    docOpen = true;
    parser = createStreamingParser();
    // seq ≥ 2 is a rewrite: the editor keeps the current text and swaps it in at doc.close
    publish({ type: "doc.open", stage: docStage, seq: docSeq, rewrite: docSeq > 1 });
  };
  const pushDoc = (text: string) => {
    for (const ev of parser.push(text)) publish(ev as unknown as { type: string } & Record<string, unknown>);
  };
  const endDoc = () => {
    if (!docOpen) return;
    docOpen = false;
    for (const ev of parser.end()) publish(ev as unknown as { type: string } & Record<string, unknown>);
    publish({ type: "doc.close", seq: docSeq });
  };

  // Primary live channel: the agent's Write of <stage>/draft.dsl.md, decoded from the streamed
  // tool input. Content that arrives before file_path is buffered until the path is known.
  const draftPath = isDoc ? resolve(workspaceDir, docStage, "draft.dsl.md") : "";
  type WriteState = { dec: WriteStreamDecoder; held: string; ours: boolean | null; deltas: number };
  const writes = new Map<string, WriteState>();
  let liveFromWrite = false;
  let lastWriteContent: string | null = null; // the last complete Write of the draft, as streamed
  const onWrite = (toolUseId: string) => {
    const st: WriteState = { dec: new WriteStreamDecoder(), held: "", ours: null, deltas: 0 };
    st.dec.cb.onFilePath = (p) => {
      st.ours = resolve(p) === draftPath;
      if (st.ours) {
        liveFromWrite = true;
        openDoc();
        if (st.held) pushDoc(st.held);
      }
      st.held = "";
    };
    st.dec.cb.onContent = (t) => {
      if (st.ours === null) st.held += t;
      else if (st.ours) pushDoc(t);
    };
    writes.set(toolUseId, st);
  };

  // Fallback channel (older prompts, or a model that skips the Write): <<<DOC … DOC>>> in text.
  extractor.onDocOpen(() => {
    if (!liveFromWrite) openDoc();
  });
  extractor.onDocDelta((text) => {
    if (!liveFromWrite) pushDoc(text);
  });
  extractor.onDocClose(() => {
    if (!liveFromWrite) endDoc();
  });

  const onEvent: StartRunInput["onEvent"] = (frame) => {
    const ev = frame.data as AgentEvent;
    if (!isDoc) return;
    if ("parentToolUseId" in ev && ev.parentToolUseId) return; // subagent activity never carries the document
    switch (ev.type) {
      case "tool.start":
        if (ev.name === "Write") onWrite(ev.toolUseId);
        break;
      case "tool.input.delta": {
        const st = writes.get(ev.toolUseId);
        if (st) {
          st.deltas++;
          st.dec.push(ev.json);
        }
        break;
      }
      case "tool.input": {
        // authoritative, complete input. Without --include-partial-messages (or when the CLI
        // sent no deltas) this is the first time we see it: decode it whole.
        const st = writes.get(ev.toolUseId);
        if (!st) break;
        const input = ev.input as { file_path?: unknown; content?: unknown } | null;
        if (st.deltas === 0 && input && typeof input === "object") st.dec.push(JSON.stringify(input));
        else if (input && typeof input.content === "string" && st.ours && input.content.length > st.dec.content.length && input.content.startsWith(st.dec.content)) {
          // the stream decoder fell short (should not happen): top it up
          pushDoc(input.content.slice(st.dec.content.length));
        }
        if (st.ours) {
          lastWriteContent = input && typeof input.content === "string" ? input.content : st.dec.content;
          endDoc(); // the Write is complete: close the open table/paragraph so the last block commits
        }
        break;
      }
      case "text.delta":
        extractor.feed(ev.text);
        break;
      case "assistant.text":
        lastAssistantText = ev.text;
        break;
      default:
        break;
    }
  };

  /** 단계 자동 연결: 성공한 뒤 다음 단계를 같은 옵션으로 시작한다(다음 단계 모델은 그 단계 기본값). */
  const chainNext = (status: string) => {
    if (!opts.autoChain || status !== "succeeded") return;
    const next = nextStage(opts.stage, opts.project.kind);
    if (!next) return;
    // the current run is being finalized in the run manager; start the next one on the next tick
    setTimeout(async () => {
      try {
        await prepareStage(opts.project, next);
        const r = startStageRun({ project: opts.project, stage: next, autoChain: true, supplementalResearch: opts.supplementalResearch });
        console.log(`[runIntegration] auto-chain: ${opts.stage} → ${next} (run ${r.runId})`);
      } catch (e) {
        console.error(`[runIntegration] auto-chain ${opts.stage} → ${next} failed:`, (e as Error).message);
      }
    }, 500);
  };

  const onEnd: StartRunInput["onEnd"] = (run) => {
    if (opts.stage === "ledger") {
      // 원장 계산·검증은 플랫폼이 한다 — 에이전트는 Bash 가 없어 스스로 검산할 수 없다.
      // 오류가 있으면 같은 세션에 오류 목록을 주고 **한 번** 고치게 하고, 그래도 남으면 연쇄를 멈춘다
      // (틀린 원장으로 결과보고서·정산보고서를 만들면 매크로가 틀린 숫자를 그대로 펼친다).
      const s = writeLedgerSummary(opts.project.id);
      const problems = s.ok ? s.result!.checks.filter((c) => c.level === "error").map((c) => c.message) : [s.error ?? "ledger.json 을 읽지 못했습니다"];
      if (!problems.length) {
        chainNext(run.status);
        return;
      }
      if (!opts.ledgerAutoFix && run.status === "succeeded" && run.sessionId) {
        setTimeout(() => {
          try {
            startStageRun({
              ...opts,
              resumeSessionId: run.sessionId!,
              ledgerAutoFix: true,
              instruction: `[자동 검증] 프로그램이 ledger.json 을 계산해 보니 다음 문제가 있다. 원자료(materials/)를 다시 확인해 ledger.json 을 Edit 로 고친다. 원자료끼리 정말 어긋나 고칠 수 없는 것은 고치지 말고 "메모"에 그 사실을 적는다.\n- ${problems.join("\n- ")}`,
            });
          } catch (e) {
            console.error("[runIntegration] ledger auto-fix failed:", (e as Error).message);
          }
        }, 500);
        return;
      }
      publish({ type: "doc.error", message: `정산 원장 검증 오류 ${problems.length}건 — ledger/summary.md 를 확인하고 자료를 보완하거나 '이어서 수정 요청'으로 지시하세요. ${problems.slice(0, 3).join(" / ")}`, status: run.status });
      return;
    }
    if (opts.stage === "research" || opts.stage === "analysis") {
      const notes = join(workspaceDir, opts.stage, "notes.md");
      if (!existsSync(notes)) publish({ type: "doc.error", message: `${opts.stage}/notes.md 가 생성되지 않았습니다. '이어서 수정 요청'으로 정리를 지시하세요.`, status: run.status });
      else chainNext(run.status);
      return;
    }
    if (!isDoc) return;
    endDoc(); // a stream cut short (limit, cancel) still closes so the editor settles
    // authoritative DSL: the content of the agent's last Write (its submission — identical to
    // the file unless the Write itself failed), else the file, else the final assistant text
    // between markers (older contract), else whatever was streamed
    const filePath = join(workspaceDir, docStage, "draft.dsl.md");
    let dsl: string | null = lastWriteContent;
    if ((!dsl || dsl.trim().length < 40) && liveFromWrite && existsSync(filePath)) dsl = readFileSync(filePath, "utf8");
    if (!dsl || dsl.trim().length < 40) dsl = extractDocFromText(lastAssistantText) ?? extractor.finalDoc() ?? null;
    if ((!dsl || dsl.trim().length < 40) && existsSync(filePath)) dsl = readFileSync(filePath, "utf8");
    if (!dsl || dsl.trim().length < 40) {
      publish({ type: "doc.error", message: sawDocOpen ? "문서가 열렸지만 내용이 비어 있습니다" : `에이전트가 ${docStage}/draft.dsl.md 를 저장하지 않았고 답변에도 <<<DOC … DOC>>> 문서가 없습니다`, status: run.status });
      return;
    }
    try {
      const { doc, warnings, version } = saveStageDsl(opts.project.id, docStage, dsl, "agent");
      publish({ type: "doc.final", doc, version, warnings });
      // Auto-export in the background (the run is already finalized, so no frame can be
      // published for it; the UI polls GET …/export or triggers POST …/export after run end).
      // 내보내기 경고(편람·쪽 나눔·금액 대조)는 에이전트가 볼 수 없어 담당자가 손으로 고쳐 왔다 — 고칠 것이 있으면
      // 같은 세션에서 **한 번** 다듬게 하고, 다듬기가 끝난 뒤에 연쇄를 잇는다(담당자 2026-10-21: 사람의 일을 덜어 주는 쪽으로).
      // 내보내기는 한글 배치 확인으로 1~4분 걸리고 한 줄로 선다 — 다듬기 뒤 보고서가 늦게 바뀐 일(2026-10-22)을 가릴 수 있게 시작·끝을 남긴다
      const exportStarted = Date.now();
      console.log(`[runIntegration] ${docStage}: export start (autoFix=${!!opts.docAutoFix})`);
      void exportStage(opts.project.id, docStage)
        .then((report) => {
          console.log(`[runIntegration] ${docStage}: export done in ${Math.round((Date.now() - exportStarted) / 1000)}s, warnings=${report?.warnings.length ?? "none"} (autoFix=${!!opts.docAutoFix})`);
          const fix = fixableWarnings(report?.warnings ?? []);
          if (fix.length && !opts.docAutoFix && opts.stage !== "review" && run.status === "succeeded" && run.sessionId) {
            startStageRun({ ...opts, resumeSessionId: run.sessionId, docAutoFix: true, instruction: docAutoFixInstruction(docStage, fix) });
            console.log(`[runIntegration] ${docStage}: 내보내기 경고 ${fix.length}건 — 자동 다듬기 시작`);
            return;
          }
          chainNext(run.status);
        })
        .catch((e: Error) => {
          console.error("[runIntegration] export/auto-fix failed:", e.message);
          chainNext(run.status);
        });
    } catch (e) {
      publish({ type: "doc.error", message: (e as Error).message });
    }
  };

  const res = rm.startRun({
    projectId: opts.project.id,
    stage: opts.stage,
    spec: {
      prompt: p.prompt,
      systemPromptAppend: p.systemPromptAppend,
      allowedTools: p.allowedTools,
      // under bypassPermissions only --tools actually restricts the tool set (no Bash for writers)
      tools: p.allowedTools,
      maxTurns: p.maxTurns ?? limits.maxTurns,
      model: modelFor(opts.stage, opts.model),
      jsonSchema: p.jsonSchema,
      addDirs: [workspaceDir, ...(wikiDir ? [wikiDir] : [])],
      ...(mcpConfigPath ? { mcpConfigPath } : {}),
      ...(opts.resumeSessionId ? { resumeSessionId: opts.resumeSessionId } : {}),
    },
    onEvent,
    onEnd,
    runner: opts.runner,
  });
  runId = res.runId;
  return res;
}
