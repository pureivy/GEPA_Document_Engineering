/**
 * 정산·결과보고(closeout) 배선 — 종류·단계 등록, 자료함, 원장 저장 시 매크로 펼침, 프롬프트.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isDocStage, isNotesStage, STAGE_FAMILY } from "../../lib/contracts";
import { stagesOf } from "../../lib/kinds";
import { parseDsl } from "../../lib/docmodel/dsl";
import { buildStagePrompt } from "../../lib/agents/prompts";
import type { ProjectDTO } from "../../lib/contracts";

let tmp: string;
beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), "gepa-closeout-"));
  process.env.DATA_DIR = tmp;
});
afterAll(async () => {
  const { closeDb } = await import("../../lib/db/client");
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

const project = (수신: string): ProjectDTO => ({
  id: "closeout1",
  kind: "closeout",
  title: "2025년 서비스산업 투자유치협의체",
  topic: "투자유치 회의 3회",
  region: "",
  organizer: "(재)경상북도경제진흥원",
  contact: { 부서명: "ESG·기업지원팀", 전화: "054-470-8565", 이메일: "a@gepa.kr", 수신유형: "수신자", 수신, 전결: "실·단장" },
  createdAt: "",
  updatedAt: "",
});

describe("closeout 종류·단계", () => {
  it("정산자료 → 결과보고서 → 정산보고서 → 제출 공문", () => {
    expect(stagesOf("closeout")).toEqual(["ledger", "result", "settlement", "submit"]);
  });
  it("정산자료는 노트 단계, 나머지는 기존 family 를 쓴다", () => {
    expect(isNotesStage("ledger")).toBe(true);
    expect(isDocStage("ledger")).toBe(false);
    expect(STAGE_FAMILY.result).toBe("plan");
    expect(STAGE_FAMILY.settlement).toBe("settlement");
    expect(STAGE_FAMILY.submit).toBe("official");
  });
});

describe("표지: 없음", () => {
  it("결재란·표지를 합성하지 않는다(위탁기관 서식)", () => {
    const { doc } = parseDsl("---\nfamily: plan\n제목: 위탁사업 추진실적 및 정산보고서\n표지: 없음\n---\nㅇ 본문\n");
    expect(doc.blocks.some((b) => b.k === "approvalBlock" || b.k === "coverTitle")).toBe(false);
  });
  it("기본값은 지금처럼 결재란+표지(사업계획서 출력 불변)", () => {
    const { doc } = parseDsl("---\nfamily: plan\n제목: 사업계획(안)\n---\nㅇ 본문\n");
    expect(doc.blocks.slice(0, 2).map((b) => b.k)).toEqual(["approvalBlock", "coverTitle"]);
  });
});

describe("자료함", () => {
  it("xlsx·csv 를 텍스트로 옮기고 목록을 쓴다", { timeout: 30_000 }, async () => {
    const { saveMaterial, listMaterials, materialsDir } = await import("../../lib/closeout/materials");
    // 최소 xlsx: 공유 문자열 + 날짜 서식(14) 셀 + 숫자 셀
    const xlsx = zipSync({
      "xl/workbook.xml": strToU8('<workbook xmlns:r="r"><sheets><sheet name="집행" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/sharedStrings.xml": strToU8("<sst><si><t>일자</t></si><si><t>금액</t></si><si><t>내역</t></si><si><t>현수막 제작</t></si></sst>"),
      "xl/styles.xml": strToU8('<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>'),
      "xl/worksheets/sheet1.xml": strToU8(
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
          '<row r="2"><c r="A2" s="1"><v>45800</v></c><c r="B2"><v>40000</v></c><c r="C2" t="s"><v>3</v></c></row></sheetData></worksheet>',
      ),
    });
    saveMaterial("p1", "집행내역.xlsx", xlsx);
    saveMaterial("p1", "통장.csv", new TextEncoder().encode("거래일,출금,적요\n2025-05-23,40000,경북기획\n"));
    const md = readFileSync(path.join(materialsDir("p1"), "text", "집행내역.xlsx.md"), "utf8");
    expect(md).toContain("| 2 | 2025-05-23 | 40000 | 현수막 제작 |");
    expect(listMaterials("p1").map((m) => [m.name, m.mode])).toEqual([
      ["집행내역.xlsx", "text"],
      ["통장.csv", "text"],
    ]);
    expect(readFileSync(path.join(materialsDir("p1"), "index.md"), "utf8")).toContain("materials/text/통장.csv.md");
  });
  it("zip 을 풀어 안의 자료를 하나씩 저장한다(폴더는 버리고, 모르는 형식·zip 속 zip 은 알린다)", async () => {
    const { saveZipMaterials, listMaterials } = await import("../../lib/closeout/materials");
    const zip = zipSync({
      "지급공문/1. 여비 지급.txt": strToU8("9월 여비 241,200원"),
      "지급공문/2. 통장.csv": strToU8("거래일,출금\n2025-05-09,241200\n"),
      "__MACOSX/._x": strToU8("x"),
      "속.zip": strToU8("PK"),
      "메모.exe": strToU8("x"),
    });
    const r = saveZipMaterials("pz", "자료묶음.zip", zip);
    expect(r.saved.sort()).toEqual(["1. 여비 지급.txt", "2. 통장.csv"]);
    expect(r.errors.map((e) => e.name)).toEqual(["자료묶음.zip/속.zip", "자료묶음.zip/메모.exe"]);
    expect(listMaterials("pz").map((m) => m.name)).toEqual(["1. 여비 지급.txt", "2. 통장.csv"]);
  });
  it("UTF-8 표시가 없는 zip 의 CP949 한글 이름을 되살린다", async () => {
    const { zipEntryName } = await import("../../lib/closeout/materials");
    // "통장" 의 CP949 바이트(C5EB C0E5)를 fflate 처럼 latin1 로 읽은 이름
    expect(zipEntryName(String.fromCharCode(0xc5, 0xeb, 0xc0, 0xe5) + ".pdf")).toBe("통장.pdf");
    expect(zipEntryName("통장.pdf")).toBe("통장.pdf");
    expect(zipEntryName("bank.pdf")).toBe("bank.pdf");
  });
  it("모르는 형식은 저장하지 않는다(.xls 는 xlsx 로 다시 저장 안내)", async () => {
    const { saveMaterial } = await import("../../lib/closeout/materials");
    expect(() => saveMaterial("p1", "old.xls", new Uint8Array([1, 2]))).toThrow(/xlsx/);
  });
});

describe("저장 시 정산 매크로 펼침", () => {
  it("원장이 있으면 표로 펼치고, 없으면 경고만 남긴다", async () => {
    const { db, schema } = await import("../../lib/db/client");
    const now = new Date().toISOString();
    db().insert(schema.projects).values({ id: "pc", kind: "closeout", title: "t", topic: "t", createdAt: now, updatedAt: now }).run();
    const { saveStageDsl } = await import("../../lib/stages/service");
    const dsl = "---\nfamily: plan\n제목: 정산보고서\n표지: 없음\n---\nㅇ 사업비: {{정산:예산액한글}}\n{{정산:총괄표}}\n";

    const missing = saveStageDsl("pc", "settlement", dsl, "agent");
    expect(missing.warnings.some((w) => w.message.includes("정산 매크로를 펼치지 못했습니다"))).toBe(true);

    const { ledgerPaths, writeLedgerSummary } = await import("../../lib/closeout/store");
    mkdirSync(ledgerPaths("pc").dir, { recursive: true });
    copyFileSync(path.join(__dirname, "../fixtures/closeout/esg1024.ledger.json"), ledgerPaths("pc").json);
    const r = saveStageDsl("pc", "settlement", dsl, "agent");
    expect(r.warnings).toEqual([]);
    expect(r.doc.blocks.filter((b) => b.k === "table")).toHaveLength(1);
    const saved = readFileSync(path.join(tmp, "projects", "pc", "settlement", "draft.dsl.md"), "utf8");
    expect(saved).toContain("금20,000,000원(금이천만원)");
    expect(saved).toContain("| 계 | 20,000,000 | 18,319,100 | 91.59 |");

    const s = writeLedgerSummary("pc");
    expect(s.ok).toBe(true);
    expect(existsSync(ledgerPaths("pc").summary)).toBe(true);
  }, 30_000); // 첫 DB 초기화(마이그레이션)가 병렬 실행 중에는 5초를 넘긴다
  it("원장 JSON 이 깨져 있으면 summary.md 에 사유를 쓴다", async () => {
    const { ledgerPaths, writeLedgerSummary } = await import("../../lib/closeout/store");
    mkdirSync(ledgerPaths("broken").dir, { recursive: true });
    writeFileSync(ledgerPaths("broken").json, "{ 사업명: ");
    const s = writeLedgerSummary("broken");
    expect(s.ok).toBe(false);
    expect(readFileSync(ledgerPaths("broken").summary, "utf8")).toContain("올바른 JSON 이 아닙니다");
  });
});

describe("closeout 프롬프트", () => {
  const ws = "/data/projects/closeout1";
  it("모든 단계가 정산 규격 스킬을 읽게 한다", () => {
    for (const stage of ["ledger", "result", "settlement", "submit"] as const) {
      const p = buildStagePrompt({ stage, project: project("고령군수(투자유치과장)"), workspaceDir: ws });
      expect(p.systemPromptAppend).toContain("gepa-closeout-design/SKILL.md");
      expect(p.prompt).toContain(`${ws}/materials/index.md`);
      expect(p.allowedTools).not.toContain("WebSearch");
    }
  });
  it("문서 단계는 숫자를 매크로로 쓰라고 한다", () => {
    const p = buildStagePrompt({ stage: "settlement", project: project("고령군수(투자유치과장)"), workspaceDir: ws });
    expect(p.prompt).toContain("{{정산:…}}");
    expect(p.prompt).toContain(`${ws.replace(/\\/g, "/")}/ledger/summary.md`);
    expect(p.prompt).toContain("family: settlement");
  });
  it("제출 공문: 시군 수신은 반납액, 도 수신은 통장잔액", () => {
    const city = buildStagePrompt({ stage: "submit", project: project("고령군수(투자유치과장)"), workspaceDir: ws });
    expect(city.prompt).toContain("{{정산:공문표}}");
    expect(city.prompt).toContain("귀 기관의 무궁한 발전");
    const prov = buildStagePrompt({ stage: "submit", project: project("경상북도지사(투자유치단장)"), workspaceDir: ws });
    expect(prov.prompt).toContain("{{정산:공문표}}");
    expect(prov.prompt).toContain("경상북도의 무궁한 발전");
  });
});

describe("요지 박스", () => {
  it("둘째 줄부터 다시 적은 박스 기호는 겹치지 않게 뗀다", () => {
    const { doc } = parseDsl("---\nfamily: plan\n제목: t\n---\n```box\n◇ (요지) 하나\n◇ (핵심 수치) 둘\n```\n");
    const box = doc.blocks.find((b) => b.k === "summaryBox");
    expect(box && box.k === "summaryBox" ? box.lines.map((l) => (l[0] as { text: string }).text) : []).toEqual(["(요지) 하나", "(핵심 수치) 둘"]);
  });
});

describe("담당자 정산보고서 재현(ESG·기업지원팀-3630)", () => {
  it("향토뿌리 원장: 항목별 당초·최종·집행·잔액이 원문과 같다", async () => {
    const { computeLedger, LedgerSchema } = await import("../../lib/closeout/ledger");
    const l = LedgerSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "../fixtures/closeout/hyangto.ledger.json"), "utf8")));
    const r = computeLedger(l);
    expect(r.checks).toEqual([]);
    expect(r.groups.map((g) => [g.비목군, g.당초예산, g.예산, g.집행, g.잔액])).toEqual([
      ["사업비", 109_500_000, 110_157_110, 110_138_920, 18_190],
      ["운영비", 2_100_000, 1_442_890, 1_430_390, 12_500],
      ["수수료", 8_400_000, 8_400_000, 8_400_000, 0],
    ]);
    expect([r.집행률, r.이자, r.반납액]).toEqual(["99.97", 37_943, 68_633]);
  });

  it("세부내역: 같은 세목(사무관리비)도 세부사업이 다르면 따로, 회의비도 빠지지 않는다", async () => {
    const { LedgerSchema } = await import("../../lib/closeout/ledger");
    const { expandLedgerMacros } = await import("../../lib/closeout/macros");
    const l = LedgerSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "../fixtures/closeout/hyangto.ledger.json"), "utf8")));
    const { text } = expandLedgerMacros("{{정산:세부내역}}", l);
    expect(text).toContain("❍ (사업비) 경상북도 향토뿌리기업 및 산업유산 신규선정(집행액: 6,480,000원)");
    expect(text).toContain("❍ (사업비) 기술혁신 역량 강화 지원사업(집행액: 38,677,110원)");
    expect(text).toContain("❍ (운영비) 회의비(집행액: 140,690원)");
    expect(text).toContain("❍ (운영비) 사무관리비(집행액: 587,100원)");
    expect(text).toContain("| 11.25. | 10,000,000 | 사업비(행사운영비) | 프로그램 운영 용역비 | 만듬㈜ | 24 |");
  });

  it("정산보고서 family 로 HWPX 가 손실 없이 만들어진다", { timeout: 60_000 }, async () => {
    const { LedgerSchema } = await import("../../lib/closeout/ledger");
    const { expandLedgerMacros } = await import("../../lib/closeout/macros");
    const { buildHwpx } = await import("../../lib/hwpx/build");
    const { validateHwpx } = await import("../../lib/hwpx/validate");
    const l = LedgerSchema.parse(JSON.parse(readFileSync(path.join(__dirname, "../fixtures/closeout/hyangto.ledger.json"), "utf8")));
    const { text } = expandLedgerMacros(readFileSync(path.join(__dirname, "../fixtures/closeout/settlement-hyangto.dsl.md"), "utf8"), l);
    const parsed = parseDsl(text);
    expect(parsed.warnings).toEqual([]);
    expect(parsed.doc.family).toBe("settlement");
    const { bytes, report } = buildHwpx(parsed.doc);
    expect(report.warnings).toEqual([]);
    const v = await validateHwpx(bytes);
    expect(v.ok).toBe(true);
    expect(v.contentLoss?.count ?? 0).toBe(0);
  });
});

describe("밖으로 나가는 공문의 발신명의", () => {
  it("경상북도지사 수신은 본부장 전결이어도 기관장 명의, 전부서 수신은 전결권자 명의", async () => {
    const { isInternalRecipient } = await import("../../lib/hwpx/writers/official");
    expect(isInternalRecipient({ 수신: "경상북도지사(기업지원과장)" })).toBe(false);
    expect(isInternalRecipient({ 수신: "고령군수(투자유치과장)" })).toBe(false);
    expect(isInternalRecipient({ 수신: "전부서" })).toBe(true);
    expect(isInternalRecipient({ 수신자: ["경영지원팀장", "마케팅팀장"] })).toBe(true);
  });
});
