/**
 * 진흥원 실문서에서 되풀이되는 표 모양을 캐내 `docs/design-system/표-양식.md` 를 만든다.
 *
 * 남의 양식 모음집을 베끼는 대신 **우리 문서가 실제로 쓰는 모양**을 근거로 삼는다. 빈도가 근거다 —
 * 서로 다른 문서 여러 건이 같은 행·열·병합을 썼다면 그 자리의 기관 관행이고, 한 문서에만 있으면
 * 그 담당자의 선택이다. 그래서 `MIN_DOCS` 건 미만은 싣지 않는다.
 *
 * 같은 문서가 여러 프로젝트 폴더에 복사돼 있으므로(실측 346개 파일 → 고유 214건) 내용 해시로 먼저 거른다.
 *
 * Usage: pnpm tsx scripts/mine-table-shapes.ts [--min=3]
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { attr, child, childrenNamed, findAll, parseXml, textOf, type XmlNode } from "../lib/hwpx/xml";

const MIN_DOCS = Number(process.argv.find((a) => a.startsWith("--min="))?.slice(6) ?? 3);
const ROOTS = ["data/projects", "templates"];
const OUT = "docs/design-system/표-양식.md";
/** 표 한 장이 서식 전체인 것(신청서)까지 받되, 쪽을 넘기는 거대 표는 본보기로 못 쓴다 */
const MAX_ROWS = 40;
const MAX_COLS = 14;

function walk(dir: string, out: string[] = []): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n.toLowerCase().endsWith(".hwpx")) out.push(p);
  }
  return out;
}

interface Shape {
  docs: Set<string>;
  nrow: number;
  ncol: number;
  headRow: string[];
  grid: string[][];
  widths: string;
  where: string;
}

/** 칸 글 — 중첩 표 안 글은 빼고(DSL 은 한 겹만 표현한다), 여러 문단은 <br> 로 잇는다 */
function cellText(tc: XmlNode): { text: string; nested: boolean } {
  const parts: string[] = [];
  let nested = false;
  for (const sl of childrenNamed(tc, "hp:subList")) {
    for (const p of childrenNamed(sl, "hp:p")) {
      if (findAll(p, "hp:tbl").length) {
        nested = true;
        continue;
      }
      // 그림의 대체 글·원본 정보는 칸 내용이 아니다 — 머리행에 섞이면 쓰임 판정까지 흐린다.
      // 그림이 있었다는 사실만 〔그림〕 으로 남긴다(화살표·도형은 DSL 로 그릴 수 없으니 알아야 한다).
      const raw = textOf(p);
      const t = raw
        .replace(/그림입니다\.?/g, "")
        .replace(/원본 그림의 (이름|크기)[\s\S]*$/, "")
        .trim();
      const hadPic = raw !== t.trim() && /그림입니다|원본 그림의/.test(raw);
      const line = hadPic ? (t ? `${t}〔그림〕` : "〔그림〕") : t;
      if (line) parts.push(line);
    }
  }
  return { text: parts.join("<br>").replaceAll("|", "¦").trim(), nested };
}

function readTable(tbl: XmlNode, nrow: number, ncol: number): { grid: string[][]; widths: string } {
  const grid: string[][] = Array.from({ length: nrow }, () => Array.from({ length: ncol }, () => ""));
  const widths = new Map<number, number>();
  for (const tr of childrenNamed(tbl, "hp:tr")) {
    for (const tc of childrenNamed(tr, "hp:tc")) {
      const addr = child(tc, "hp:cellAddr");
      const span = child(tc, "hp:cellSpan");
      const sz = child(tc, "hp:cellSz");
      if (!addr) continue;
      const r0 = Number(attr(addr, "rowAddr") ?? -1);
      const c0 = Number(attr(addr, "colAddr") ?? -1);
      if (r0 < 0 || c0 < 0 || r0 >= nrow || c0 >= ncol) continue;
      const rs = Number((span && attr(span, "rowSpan")) ?? 1) || 1;
      const cs = Number((span && attr(span, "colSpan")) ?? 1) || 1;
      const { text, nested } = cellText(tc);
      grid[r0][c0] = text + (nested ? "〔중첩표〕" : "");
      const w = Number((sz && attr(sz, "width")) ?? 0);
      if (w && cs === 1 && !widths.has(c0)) widths.set(c0, w);
      for (let dc = 1; dc < cs; dc++) if (c0 + dc < ncol) grid[r0][c0 + dc] = "<";
      for (let dr = 1; dr < rs; dr++)
        for (let dc = 0; dc < cs; dc++) if (r0 + dr < nrow && c0 + dc < ncol) grid[r0 + dr][c0 + dc] = "^";
    }
  }
  // HWPUNIT(1/7200인치) → pt(1/72인치)
  const w = Array.from({ length: ncol }, (_, i) => (widths.has(i) ? String(Math.round(widths.get(i)! / 10) / 10) : "?")).join(",");
  return { grid, widths: w };
}

// ---- 쓰임 분류: 머리행 낱말로 가른다
type Kind = "결재란" | "절차" | "지원내용" | "예산" | "현황" | "평가" | "일정" | "통계" | "개인정보" | "서식" | "기타";
function kindOf(head: string[]): Kind {
  const h = head.join(" ");
  if (/등록번호/.test(h) && /(팀장|담\s*당)/.test(h)) return "결재란";
  const steps = (h.match(/공고|모집|접수|선정|지급|협약|평가|수행|체결/g) ?? []).length;
  if (steps >= 3 && !/구분/.test(h)) return "절차";
  if (/지원\s*항목|지원\s*가능\s*항목|지원\s*한도/.test(h)) return "지원내용";
  if (/금액|예산|공급가액|부가세|집행|비목|지출/.test(h)) return "예산";
  if (/기\s*업\s*명/.test(h)) return "현황";
  if (/지표|심사|배점/.test(h)) return "평가";
  if (/수집|주민등록번호|서\s*명/.test(h)) return "개인정보";
  if (/일자|시간|기간/.test(h)) return "일정";
  if (/소재지|기업수|유산수/.test(h)) return "통계";
  if (head.length === 1) return "서식";
  return "기타";
}
const ROLE: Partial<Record<Kind, string>> = { 예산: "budget", 일정: "schedule", 평가: "evalCriteria", 현황: "support", 절차: "flowDiagram" };
const SECTIONS: [Kind, string, string][] = [
  ["절차", "추진 절차 · 순서도", "계획서·공고의 「추진절차」 자리. 단계를 가로로 늘어놓고 사이에 좁은 열을 둬 화살표 자리로 쓴다."],
  ["지원내용", "지원 내용 · 한도", "「지원내용」·「지원금액」 자리. 구분(분야) / 항목 / 한도 세 열이 기본이다."],
  ["예산", "소요예산 · 집행", "「소요예산」·「집행내역」 자리. 금액 열은 오른쪽 정렬, 표 위에 `(단위: 원)` 캡션을 둔다."],
  ["현황", "지원 현황 · 선정 결과", "결과보고서의 기업별 지원 현황, 선정 통보 공문의 선정 내용 자리."],
  ["평가", "평가 · 심사 기준", "공고 붙임의 평가표. 구분 / 지표 / 세부 심사내용."],
  ["일정", "일정표", "행사·교육 일정. 일자 / 시간 / 내용 / 비고."],
  ["통계", "현황 통계", "시군별 분포 등 집계표."],
  ["개인정보", "개인정보 수집·이용 동의", "공고 붙임 서식의 고정 표."],
  ["서식", "제출 서식", "표 한 장이 서식 전체인 것. 머리글이 제목 한 칸이다."],
  ["기타", "기타", ""],
];

// ---- 모으기
const seen = new Set<string>();
const files: string[] = [];
for (const r of ROOTS)
  for (const f of walk(r)) {
    const h = createHash("md5").update(readFileSync(f)).digest("hex");
    if (seen.has(h)) continue;
    seen.add(h);
    files.push(f);
  }

const shapes = new Map<string, Shape>();
let tableCount = 0;
for (const path of files) {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(readFileSync(path));
  } catch {
    continue;
  }
  const docName = path.split(/[\\/]/).pop()!;
  for (const [name, bytes] of Object.entries(entries)) {
    if (!/^Contents\/section\d+\.xml$/.test(name)) continue;
    let root: XmlNode;
    try {
      root = parseXml(Buffer.from(bytes).toString("utf8"));
    } catch {
      continue; // 배포용 암호가 걸린 본문은 글자가 아니다 — 건너뛴다
    }
    let where: string[] = [];
    for (const p of childrenNamed(root, "hp:p")) {
      const tbls = findAll(p, "hp:tbl");
      if (!tbls.length) {
        const t = textOf(p).trim();
        if (t) where = [...where, t].slice(-2);
        continue;
      }
      for (const tbl of tbls) {
        const nrow = Number(attr(tbl, "rowCnt") ?? 0);
        const ncol = Number(attr(tbl, "colCnt") ?? 0);
        if (nrow < 2 || ncol < 2 || nrow > MAX_ROWS || ncol > MAX_COLS) continue;
        const { grid, widths } = readTable(tbl, nrow, ncol);
        const headRow = grid[0].filter((c) => c && c !== "<" && c !== "^");
        if (!headRow.length) continue;
        tableCount++;
        const merge = grid.flat().map((c) => (c === "<" || c === "^" ? "M" : ".")).join("");
        const key = `${nrow}x${ncol}|${merge}|${headRow.slice(0, 6).map((h) => h.slice(0, 10)).join("/")}`;
        const cur = shapes.get(key);
        if (cur) cur.docs.add(docName);
        else shapes.set(key, { docs: new Set([docName]), nrow, ncol, headRow, grid, widths, where: where.join(" / ").slice(0, 60) });
      }
    }
  }
}

const kept = [...shapes.values()].filter((s) => s.docs.size >= MIN_DOCS);
const dropped = kept.filter((s) => kindOf(s.headRow) === "결재란");
const bySection = new Map<Kind, Shape[]>();
for (const s of kept) {
  const k = kindOf(s.headRow);
  if (k === "결재란") continue;
  bySection.set(k, [...(bySection.get(k) ?? []), s]);
}
const shown = kept.length - dropped.length;

function dsl(s: Shape): string {
  const role = ROLE[kindOf(s.headRow)] ?? "generic";
  const head = s.widths.includes("?") ? `{table role=${role}}` : `{table role=${role} widths=${s.widths}}`;
  const lines = [head];
  s.grid.forEach((row, i) => {
    lines.push("| " + row.map((c) => c || " ").join(" | ") + " |");
    if (i === 0) lines.push("|" + "---|".repeat(s.ncol));
  });
  return lines.join("\n");
}

const out: string[] = [];
out.push(`# 표 양식 — 진흥원 실문서에서 되풀이되는 표 모양

> **출처**: 이 저장소에 올라온 진흥원 실문서 HWPX **${files.length}건**(내용 해시 기준 고유, \`data/projects/*/materials\`, \`templates/*/reference.hwpx\`).
> 표 **${tableCount}개**를 기계로 읽어 행·열·병합이 같은 것을 묶었다. 서로 다른 모양 ${shapes.size}개 가운데
> **서로 다른 문서 ${MIN_DOCS}건 이상에서 되풀이된 모양 ${shown}개**만 실었다 — 한 문서에만 있는 모양은 그 담당자의 선택이지 기관 관행이 아니다.
> \`pnpm tsx scripts/mine-table-shapes.ts\` 로 다시 만든다. 자료가 쌓일수록 근거가 늘어난다.
> 칸 글은 실문서 그대로다(사업명·기업명이 보이면 자리 표시로만 읽고 그대로 쓰지 않는다).

## 쓰는 법

- **빈도가 근거다.** \`n건\`은 서로 다른 문서 몇 건이 그 모양을 썼는지다. 숫자가 클수록 그 자리의 기관 표준에 가깝다.
- \`widths\` 는 실측 pt 다. 본문 폭이 다르면 비율만 지키고 다시 잡는다. \`?\` 는 병합 때문에 실측이 없는 열이다.
- \`role\` 은 내용으로 미뤄 넣은 값이다. \`flowDiagram\` 은 스키마에는 있으나 전용 작성기가 없어 지금은 \`generic\` 과 같게 그려진다.
- \`〔중첩표〕\` 는 칸 안에 표가 또 있다는 뜻이다. DSL 은 한 겹만 표현하니 그 자리는 글로 풀거나 표를 나눈다.
- \`〔그림〕\` 은 그 칸이 그림이라는 뜻이다(대개 단계 사이의 화살표). DSL 로는 그릴 수 없으니 \`»\` 같은 글자로 대신하거나 빈 칸으로 둔다.
- 공문 머리표·결재란(\`등록번호 / 담당 / 팀장 / 실장\`)은 ${dropped.length}개 모양이 잡혔으나 **싣지 않았다** — 시스템이 \`meta\` 에서 만들어 내므로 DSL 로 그릴 일이 없다.

## 차례

| 쓰임 | 모양 |
|---|---|`);
for (const [kind, title] of SECTIONS) {
  const list = bySection.get(kind);
  if (list?.length) out.push(`| ${title} | ${list.length}개 |`);
}
out.push("", "---", "");
for (const [kind, title, note] of SECTIONS) {
  const list = bySection.get(kind);
  if (!list?.length) continue;
  out.push(`## ${title}`, "");
  if (note) out.push(note, "");
  list.sort((a, b) => b.docs.size - a.docs.size);
  list.forEach((s, i) => {
    out.push(`### ${i + 1}. ${s.headRow.slice(0, 5).join(" · ").slice(0, 70)}`, "");
    out.push(`**${s.docs.size}건** · ${s.nrow}행 × ${s.ncol}열`, "");
    if (s.where) out.push(`놓인 자리: ${s.where}`, "");
    out.push("```", dsl(s), "```", "");
  });
}
writeFileSync(OUT, out.join("\n"), "utf8");
console.log(`고유 문서 ${files.length}건 · 표 ${tableCount}개 · 모양 ${shapes.size}개 → ${shown}개 실음(결재란 ${dropped.length}개 제외)`);
console.log("wrote", OUT);
