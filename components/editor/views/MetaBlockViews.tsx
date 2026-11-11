"use client";
/**
 * React node views for the blocks that are rendered from `meta` rather than from their own
 * content: `noticeHeader`, `approvalBlock`, `pressHeader`. They are read-only in the editor;
 * the meta itself is edited through the side sheet (MetaSheet).
 */
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Pencil } from "lucide-react";
import type { NoticeMeta, PlanMeta, PressMeta } from "@/lib/docmodel/schema";
import { ApprovalBlock, NoticeHeader, PressHeader } from "../nodes/atoms";
import { useDocMeta } from "../MetaContext";

function EditButton({ onEdit }: { onEdit?: () => void }) {
  if (!onEdit) return null;
  return (
    <button type="button" className="hwp-meta-edit inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-600 shadow-sm hover:bg-slate-50" onClick={onEdit} contentEditable={false}>
      <Pencil className="h-3 w-3" /> 메타 편집
    </button>
  );
}

const ph = (v: string | undefined | null, fallback: string) => (v && v.trim() ? v : fallback);

function NoticeHeaderView() {
  const { meta, onEdit } = useDocMeta();
  const m = (meta ?? {}) as Partial<NoticeMeta>;
  const title = `「${ph(m.사업명, "사업명")}」`;
  const sub = `${ph(m.모집대상, "참여기업")} 모집 공고${m.부제 ? `(${m.부제})` : ""}`;
  const greeting = `  ${ph(m.주관기관, "주관기관")}와 (재)경상북도경제진흥원에서 추진하는 「${ph(m.사업명, "사업명")}」참여 기업을 모집하오니 ${ph(m.지역, "지역")} 내 ${ph(m.대상기업군, "중소기업")}의 많은 참여를 바랍니다.`;
  return (
    <NodeViewWrapper className="hwp-notice-header hwp-meta-block" data-gepa-notice-header="" contentEditable={false}>
      <EditButton onEdit={onEdit} />
      <div className="hwp-nh-number">(재)경상북도경제진흥원 공고 제{ph(m.공고번호, "0000000000")}호</div>
      <div className="hwp-nh-title">
        {title}
        <br />
        {sub}
      </div>
      <div className="hwp-nh-greeting">{greeting}</div>
      <div className="hwp-nh-date">{ph(m.공고연월, "2026. 00.")}</div>
      <div className="hwp-nh-signer">{ph(m.기관장, "(재)경상북도경제진흥원장")}</div>
    </NodeViewWrapper>
  );
}

function ApprovalBlockView() {
  const { meta, onEdit } = useDocMeta();
  const m = (meta ?? {}) as Partial<PlanMeta>;
  const a = m.결재 ?? {};
  const cols: [string, string | undefined][] = [
    ["담당", a.담당],
    ["팀장", a.팀장],
    ["실장", a.실장],
    ["본부장", a.본부장],
    ["원장", a.원장],
  ];
  return (
    <NodeViewWrapper className="hwp-approval hwp-meta-block" data-gepa-approval="" contentEditable={false}>
      <EditButton onEdit={onEdit} />
      <table>
        <tbody>
          <tr>
            <td className="logo" colSpan={7}>
              GEPA 경상북도경제진흥원 (로고)
            </td>
          </tr>
          <tr>
            <td className="lbl" rowSpan={2} style={{ width: "16mm" }}>
              등록번호
            </td>
            <td rowSpan={2} style={{ width: "28mm" }}>
              {m.등록번호 ?? ""}
            </td>
            {cols.map(([k]) => (
              <td key={k} className="lbl">
                {k}
              </td>
            ))}
          </tr>
          <tr>
            {cols.map(([k, v]) => (
              <td key={k} style={{ height: "10mm" }}>
                {v ?? ""}
              </td>
            ))}
          </tr>
          <tr>
            <td className="lbl">등록일자</td>
            <td>{a.등록일자 ?? ""}</td>
            <td className="lbl">결재일자</td>
            <td colSpan={2}>{a.결재일자 ?? ""}</td>
            <td className="lbl">공개구분</td>
            <td>{a.공개구분 ?? ""}</td>
          </tr>
          <tr>
            <td className="lbl">협조</td>
            <td colSpan={6} style={{ textAlign: "left" }}>
              {a.협조 ?? ""}
            </td>
          </tr>
        </tbody>
      </table>
    </NodeViewWrapper>
  );
}

/** 머리표 보조 — 작성기(lib/hwpx/writers/press.ts)와 같은 규칙의 브라우저용 복제(작성기는 node 전용 모듈을 끌어온다) */
function pressProvideDate(s?: string): string {
  const m = (s ?? "").trim().match(/(\d{2,4})\s*[.년]\s*(\d{1,2})\s*[.월]\s*(\d{1,2})/);
  if (!m) return (s ?? "").trim() || "-";
  const y = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${y}. ${Number(m[2])}. ${Number(m[3])}.`;
}
function pressHeaderDate(s?: string): string {
  return pressProvideDate(s).replace(/^(19|20)(\d{2})\./, "$2.");
}
const PRESS_TITLES = new Set(["담당", "책임", "실장", "팀장", "과장", "부장", "원장", "소장", "차장", "국장", "처장", "대리", "주임", "사원", "선임", "주무관", "사무관", "담당관", "연구원", "본부장", "센터장", "지소장", "단장", "전문위원", "선임연구원", "책임연구원"]);
/** "실장 남상범" → "남상범 실장" (새 서식은 이름 직위 순서) */
function pressPerson(s?: string): string {
  const tokens = (s ?? "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  const isTitle = (t: string) => PRESS_TITLES.has(t) || (t.length === 2 && /(장|관|원|리|임|사)$/.test(t));
  if (tokens.length >= 2 && isTitle(tokens[0])) return `${tokens.slice(1).join(" ")} ${tokens[0]}`;
  return tokens.join(" ");
}
const pressDotted = (s?: string) => (s ?? "").trim().replace(/-/g, ".");

/** 2026년 보도자료 머리표(docs/design-system/press.md §3.1~3.2): [GEPA 마크 / 보도자료【날짜】] ‖ [제공일자 / 제공부서 / 주책임자 / 담 당 자] + 전화·FAX·전자우편 줄 */
function PressHeaderView() {
  const { meta, onEdit } = useDocMeta();
  const m = (meta ?? {}) as Partial<PressMeta>;
  const contact = [`전화: ${pressDotted(m.연락처) || "-"}`, `FAX: ${pressDotted(m.팩스) || "054.472.2989"}`];
  if (m.이메일) contact.push(`전자우편: ${m.이메일}`);
  return (
    <NodeViewWrapper className="hwp-press-header hwp-meta-block" data-gepa-press-header="" contentEditable={false}>
      <EditButton onEdit={onEdit} />
      <div className="hwp-ph-grid">
        <table className="hwp-ph-table hwp-ph-left">
          <tbody>
            <tr>
              <td className="hwp-ph-logo">
                <span className="hwp-ph-gepa">GEPA</span>
              </td>
            </tr>
            <tr>
              <td className="hwp-ph-logotype">
                <span className="hwp-ph-title">보도자료</span>
                <span className="hwp-ph-date">【{pressHeaderDate(m.배포일)}】</span>
              </td>
            </tr>
          </tbody>
        </table>
        <table className="hwp-ph-table hwp-ph-right">
          <tbody>
            <tr>
              <td className="hwp-ph-k">제공일자</td>
              <td>{pressProvideDate(m.배포일)}</td>
            </tr>
            <tr>
              <td className="hwp-ph-k">제공부서</td>
              <td>{ph(m.담당부서, "-")}</td>
            </tr>
            <tr>
              <td className="hwp-ph-k">주책임자</td>
              <td>{pressPerson(m.책임자) || "-"}</td>
            </tr>
            <tr>
              <td className="hwp-ph-k">담 당 자</td>
              <td>{pressPerson(m.담당자) || "-"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="hwp-ph-contact">{contact.join(" / ")}</div>
      <div className="hwp-ph-extra">
        보도시점 {ph(m.보도시점, "즉시")} · 사진 {m.사진 ? "있음" : "없음"} · 붙임 {m.붙임?.length ? m.붙임.join(", ") : "-"}
      </div>
    </NodeViewWrapper>
  );
}

/** node extensions with the React views attached (browser only) */
export const NoticeHeaderWithView = NoticeHeader.extend({
  addNodeView() {
    return ReactNodeViewRenderer(NoticeHeaderView);
  },
});
export const ApprovalBlockWithView = ApprovalBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ApprovalBlockView);
  },
});
export const PressHeaderWithView = PressHeader.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PressHeaderView);
  },
});
