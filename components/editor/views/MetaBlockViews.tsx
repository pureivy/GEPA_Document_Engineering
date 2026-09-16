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

function PressHeaderView() {
  const { meta, onEdit } = useDocMeta();
  const m = (meta ?? {}) as Partial<PressMeta>;
  return (
    <NodeViewWrapper className="hwp-press-header hwp-meta-block" data-gepa-press-header="" contentEditable={false}>
      <EditButton onEdit={onEdit} />
      <table className="hwp-ph-table">
        <tbody>
          <tr>
            <td className="hwp-ph-logo" rowSpan={4}>
              <span className="hwp-ph-gepa">GEPA</span>
              <span className="hwp-ph-org">{ph(m.기관, "(재)경상북도경제진흥원")}</span>
            </td>
            <td className="hwp-ph-logotype" rowSpan={4}>
              <span className="hwp-ph-title">보도자료</span>
              <span className="hwp-ph-date">【{ph(m.배포일, "-")}】</span>
            </td>
            <td className="hwp-ph-k">담당부서</td>
            <td colSpan={2}>{ph(m.담당부서, "-")}</td>
          </tr>
          <tr>
            <td className="hwp-ph-k" rowSpan={2}>작 성 자</td>
            <td colSpan={2}>{m.책임자 ? `${m.책임자} · ${ph(m.담당자, "-")}` : ph(m.담당자, "-")}</td>
          </tr>
          <tr>
            <td colSpan={2}>{ph(m.이메일, "-")}</td>
          </tr>
          <tr>
            <td className="hwp-ph-k">연 락 처</td>
            <td colSpan={2}>{ph(m.연락처, "-")}</td>
          </tr>
        </tbody>
      </table>
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
