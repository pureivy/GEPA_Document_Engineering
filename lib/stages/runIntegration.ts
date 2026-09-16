/**
 * Wires a stage run to the document pipeline:
 *   Write(<stage>/draft.dsl.md) tool.input.delta ─▶ WriteStreamDecoder ─▶ streaming DSL parser ─▶ `doc` SSE frames
 *   (fallback) agent text.delta ─▶ DocExtractor (<<<DOC … DOC>>>) ─▶ same parser
 *   run end ─▶ authoritative DSL (the file the agent wrote, else the final assistant text) ─▶ save version
 *            ─▶ build HWPX + validate + render ─▶ `doc.final` / `export` frames
 * Research runs stream `research/notes.md` content instead of a DocModel.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
import type { ProjectDTO, Stage } from "../contracts";

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
}

const PIPELINE: Stage[] = ["research", "plan", "notice", "press"];
export function nextStage(stage: Stage | "review"): Stage | null {
  const i = PIPELINE.indexOf(stage as Stage);
  return i >= 0 && i + 1 < PIPELINE.length ? PIPELINE[i + 1] : null;
}

/** The MCP tool ids that will actually work with the configured keys (for the prompt). */
function availableDataTools(env: Record<string, string | undefined> = process.env): string[] {
  const st = researchDataSourcesStatus(env);
  const ids = new Set(callableDataGoKrServices(env).map((s) => s.id));
  const byTool: Record<string, boolean> = {
    data_sources_status: true,
    customs_trade: ["15101643", "15134343", "15101612", "15100475"].some((id) => ids.has(id)),
    store_stats: ids.has("15012005"),
    store_upjong_codes: ids.has("15012005"),
    policy_news_search: ids.has("15095335"),
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
  const workspaceDir = stageDir(opts.project.id, "research").replace(/\/research$/, "");
  const researchCapable = opts.stage === "research" || opts.stage === "plan";
  // public-data MCP server + read-only wiki snapshot for the stages that research
  let mcpConfigPath: string | undefined;
  let wikiDir: string | undefined;
  if (researchCapable) {
    mcpConfigPath = writeResearchMcpConfig({ dir: join(dataDir(), "mcp") }) ?? undefined;
    const wikiSrc = process.env.GEPA_WIKI_DIR?.trim();
    if (wikiSrc) {
      try {
        const r = syncWikiSnapshot(wikiSrc, wikiSnapshotDir(dataDir()));
        wikiDir = r.dir;
        if (r.copied) console.log(`[runIntegration] wiki snapshot: ${r.copied}/${r.total} files updated`);
      } catch (e) {
        console.error("[runIntegration] wiki snapshot failed:", (e as Error).message);
      }
    }
  }
  const dataTools = mcpConfigPath ? availableDataTools() : undefined;
  const input: StagePromptInput = { stage: opts.stage, project: opts.project, workspaceDir, instruction: opts.instruction, reviewTarget: opts.reviewTarget, dataTools, wikiDir, supplementalResearch: opts.supplementalResearch };
  const p = buildStagePrompt(input);
  const limits = limitsFor(opts.stage);
  const isDocStage = opts.stage === "plan" || opts.stage === "notice" || opts.stage === "press";
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
  const draftPath = isDocStage ? resolve(workspaceDir, docStage, "draft.dsl.md") : "";
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
    if (!isDocStage) return;
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
    const next = nextStage(opts.stage);
    if (!next) return;
    // the current run is being finalized in the run manager; start the next one on the next tick
    setTimeout(() => {
      try {
        const r = startStageRun({ project: opts.project, stage: next, autoChain: true, supplementalResearch: opts.supplementalResearch });
        console.log(`[runIntegration] auto-chain: ${opts.stage} → ${next} (run ${r.runId})`);
      } catch (e) {
        console.error(`[runIntegration] auto-chain ${opts.stage} → ${next} failed:`, (e as Error).message);
      }
    }, 500);
  };

  const onEnd: StartRunInput["onEnd"] = (run) => {
    if (opts.stage === "research") {
      const notes = join(workspaceDir, "research", "notes.md");
      if (!existsSync(notes)) publish({ type: "doc.error", message: "research/notes.md 가 생성되지 않았습니다. '이어서 수정 요청'으로 종합을 지시하세요.", status: run.status });
      else chainNext(run.status);
      return;
    }
    if (!isDocStage) return;
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
      void exportStage(opts.project.id, docStage).catch((e: Error) => console.error("[runIntegration] export failed:", e.message));
      chainNext(run.status);
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
