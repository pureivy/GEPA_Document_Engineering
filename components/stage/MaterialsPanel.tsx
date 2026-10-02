"use client";
/**
 * 정산·결과보고 자료함 — 정산자료 단계 화면 위에 붙는다. 프로젝트를 만든 뒤에도 자료를 더 올리거나 뺄 수 있다.
 * 자료를 바꾼 뒤에는 정산자료 단계를 다시 실행해야 원장에 반영된다(올리는 것만으로 원장은 바뀌지 않는다).
 */
import { useEffect, useState } from "react";
import { FileSpreadsheet, Trash2, Upload } from "lucide-react";
import { api, errorMessage, type MaterialDTO } from "@/lib/client/api";

const ACCEPT = ".xlsx,.csv,.hwp,.hwpx,.pdf,.docx,.md,.txt,.png,.jpg,.jpeg";

export function MaterialsPanel({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const [items, setItems] = useState<MaterialDTO[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [progress, setProgress] = useState("");

  // 처음 열 때 한 번 읽는다 — 상태는 응답 콜백 안에서만 바뀐다(ProjectList 의 목록 읽기와 같은 꼴)
  useEffect(() => {
    let active = true;
    api
      .listMaterials(projectId)
      .then((r) => {
        if (active) setItems(r.materials);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.uploadMaterials(projectId, files, (done, total, name) => setProgress(done < total ? `${done + 1}/${total} ${name}` : ""));
      setItems(r.materials);
      setChanged(true);
      if (r.errors.length) setError(`읽지 못한 자료: ${r.errors.map((e) => `${e.name}(${e.message})`).join(", ")}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      setItems((await api.deleteMaterial(projectId, name)).materials);
      setChanged(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-b border-slate-200 bg-white px-4 py-3">
      <div className="mb-2 flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-slate-500" />
        <span className="text-xs font-semibold text-slate-700">올린 자료 {items ? `${items.length}건` : ""}</span>
        <label className={`ml-auto inline-flex cursor-pointer items-center gap-1 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 ${busy || disabled ? "pointer-events-none opacity-50" : ""}`}>
          <Upload className="h-3 w-3" /> 자료 추가
          <input
            type="file"
            multiple
            className="hidden"
            accept={ACCEPT}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              void upload(files);
            }}
          />
        </label>
      </div>
      {items && items.length === 0 ? <p className="text-[11px] text-slate-500">아직 자료가 없습니다. 사업계획서·예산집행 집계표·통장거래내역 등을 올리세요.</p> : null}
      {items && items.length ? (
        <ul className="grid max-h-36 gap-1 overflow-y-auto text-[11px] text-slate-700">
          {items.map((m) => (
            <li key={m.name} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1">
              <span className="flex-1 truncate" title={m.note ?? m.readPath}>
                {m.name}
              </span>
              <span className="text-slate-400">{m.mode === "text" ? "텍스트 변환" : "원본 읽기"}</span>
              <span className="w-14 text-right text-slate-400">{Math.max(1, Math.round(m.bytes / 1024))} KB</span>
              <button type="button" aria-label={`${m.name} 삭제`} disabled={busy || disabled} className="rounded p-0.5 text-slate-400 hover:text-red-600 disabled:opacity-40" onClick={() => void remove(m.name)}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {progress ? <p className="mt-2 text-[11px] text-sky-700">올리는 중 {progress}</p> : null}
      {changed ? <p className="mt-2 text-[11px] text-amber-700">자료가 바뀌었습니다 — ‘실행’을 눌러 정산 원장을 다시 만드세요.</p> : null}
      {error ? <p className="mt-2 rounded bg-red-50 p-2 text-[11px] text-red-700">{error}</p> : null}
    </div>
  );
}
