/**
 * 쪽 채움 진단 — 내보낸 .hwpx 를 rhwp 로 배치해 쪽마다 아래에 남은 여백을 잰다.
 *
 *   pnpm tsx scripts/page-fill-report.ts <파일.hwpx>
 *   pnpm tsx scripts/page-fill-report.ts <프로젝트id> <단계>
 *
 * 쪽 아래가 크게 빈 쪽을 찾아 내고, 쪽 채움(fillTextPages)이 왜 그 쪽을 손대지 않았는지
 * 조건별로 보여 준다. 수치는 HWPUNIT(1 mm = 283.46)과 본문 높이 대비 %.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layoutOf, buildLaidOut } from "../lib/hwpx/keepPass";
import { childrenNamed, parseXml, textOf } from "../lib/hwpx/xml";
import { DocModelSchema } from "../lib/docmodel/schema";
import { resolveAsset } from "../lib/closeout/photos";

const MM = 7200 / 25.4;
const mm = (v: number) => (v / MM).toFixed(1);

async function main() {
  const args = process.argv.slice(2);
  const rebuild = args.includes("--rebuild");
  const [a, b] = args.filter((s) => !s.startsWith("--"));
  if (!a) {
    console.error("사용법: page-fill-report.ts <파일.hwpx> | <프로젝트id> <단계> [--rebuild]");
    process.exit(1);
  }
  const stage = b ?? "result";
  const file = a.endsWith(".hwpx") ? a : join("data", "projects", a, stage, "out.hwpx");
  let bytes: Uint8Array;
  if (rebuild) {
    // 한글은 쓰지 않는다 — rhwp 배치로만 잰다(최종 확인은 한글로)
    process.env.GEPA_NO_HANGUL = "1";
    const doc = DocModelSchema.parse(JSON.parse(readFileSync(join("data", "projects", a, stage, "doc.json"), "utf8")));
    const built = await buildLaidOut(doc, { assets: (src) => resolveAsset(a, src) });
    bytes = built.bytes;
    const out = file.replace(/\.hwpx$/, ".rebuilt.hwpx");
    writeFileSync(out, bytes);
    console.log(`다시 빌드: ${out}\n`);
  } else bytes = new Uint8Array(readFileSync(file));
  const lay = await layoutOf(bytes);
  if (!lay) {
    console.error("배치를 읽지 못했습니다:", file);
    process.exit(1);
  }
  const { pos, top, body } = lay;
  const height = body.bottom - body.top;
  const explicit = new Set(
    childrenNamed(parseXml(lay.kept.sectionXml), "hp:p")
      .map((p, k) => (p.attrs.pageBreak === "1" ? k : -1))
      .filter((k) => k >= 0),
  );
  const pages = Math.max(...pos.map((q) => q.page)) + 1;
  console.log(`${file}\n쪽 ${pages}개 · 본문 높이 ${mm(height)} mm (${body.top}~${body.bottom})\n`);
  console.log("쪽  채운높이   남은여백        마지막 문단                         판정");
  console.log("─".repeat(104));
  for (let page = 0; page < pages; page++) {
    const ks = pos.map((q, k) => (q.page === page ? k : -1)).filter((k) => k >= 0);
    if (!ks.length) continue;
    const last = ks[ks.length - 1];
    const next = last + 1;
    const q = pos[last];
    const pageTop = Math.min(...ks.map((k) => pos[k].top));
    const used = Number.isFinite(q.bottom) ? q.bottom - pageTop : NaN;
    const room = Number.isFinite(q.bottom) ? body.bottom - q.bottom : NaN;
    const label = (textOf(top[last]).trim() || "(표·그림)").slice(0, 28);
    const why: string[] = [];
    const isLastPage = page === pages - 1;
    if (!Number.isFinite(q.bottom)) why.push("아래끝 못 잼(표·두쪽 문단)");
    if (next >= top.length) why.push("문서 끝");
    else if (explicit.has(next)) why.push("다음 쪽이 쪽 나눔으로 시작(제목 넘김 보정이 건 것 포함)");
    if (!ks.some((k) => !pos[k].hasTable)) why.push("글 문단 없음(표만)");
    if (Number.isFinite(used) && used * 2 < height) why.push("쪽 절반 미만 — 채우기 대상 아님");
    const big = Number.isFinite(room) && room >= 3000;
    const verdict = isLastPage ? "마지막 쪽" : big ? (why.length ? `크게 빔 ← ${why.join(" / ")}` : "크게 빔 ← 조건은 통과(보정 실패)") : why.length ? why.join(" / ") : "OK";
    const pct = Number.isFinite(room) ? `${Math.round((room / height) * 100)}%` : "-";
    console.log(
      `${String(page + 1).padStart(2)}  ${Number.isFinite(used) ? `${mm(used)} mm`.padStart(8) : "        "}  ${Number.isFinite(room) ? `${mm(room)} mm (${pct})`.padStart(16) : "".padStart(16)}  ${label.padEnd(30)}  ${verdict}`,
    );
  }
  console.log("\n※ 남은여백 10 mm(약 3000 HWPUNIT) 이상이면 '크게 빔'. 마지막 쪽은 비어도 된다.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
