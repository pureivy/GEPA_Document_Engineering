"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FolderOpen, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import type { ProjectDTO } from "@/lib/contracts";
import { api, errorMessage, type NewProjectInput } from "@/lib/client/api";
import { cn, formatDateTime } from "@/lib/client/format";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { KIND_LABEL, PROJECT_KINDS, type ProjectKind } from "@/lib/kinds";
import { PREF_PLAN_RESEARCH, useBoolPref, writePref } from "@/lib/client/prefs";

/** 종류별 한 줄 설명 — 라디오 옆에 그대로 보인다 */
const KIND_HINT: Record<ProjectKind, string> = {
  program: "조사 → 사업계획서 → 공고문 → 보도자료를 차례로 만듭니다.",
  official: "별지 제1호 기안문 한 건을 만듭니다.",
};

/** 공문 수신유형 — 값은 OfficialMetaSchema 의 수신유형과 글자까지 같아야 한다(그대로 front-matter 로 간다) */
const RECIPIENT_KINDS = ["내부결재", "수신자", "수신자참조"] as const;
type RecipientKind = (typeof RECIPIENT_KINDS)[number];
/** 수신유형별로 값을 담는 front-matter 키. 내부결재는 수신 대상이 없다 */
const RECIPIENT_KEY: Record<RecipientKind, "" | "수신" | "수신자"> = { 내부결재: "", 수신자: "수신", 수신자참조: "수신자" };

const EMPTY: NewProjectInput = {
  kind: "program",
  title: "",
  topic: "",
  region: "안동시",
  organizer: "(재)경상북도경제진흥원",
  contact: { 부서명: "", 담당자: "", 전화: "", 이메일: "", 우편주소: "" },
};

/** mounted only while open, so every opening starts from a blank form */
function NewProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (p: ProjectDTO) => void }) {
  const [form, setForm] = useState<NewProjectInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 기존 사업계획서 업로드 (선택): 파일 + 바뀌는 내용 → 업로드 후 전체 자동 실행
  const [refFile, setRefFile] = useState<File | null>(null);
  const [changes, setChanges] = useState("");
  const [autoRun, setAutoRun] = useState(true);
  // 공문 전용 입력. DB 컬럼이 아니라 topic 에 실려 프롬프트로 가고, 에이전트가 front-matter 에 쓴다(스펙 §5.4)
  const [recipientKind, setRecipientKind] = useState<RecipientKind>("수신자");
  const [recipient, setRecipient] = useState("");
  const planResearch = useBoolPref(PREF_PLAN_RESEARCH, false);
  const [phase, setPhase] = useState<"" | "create" | "upload">("");

  const kind = form.kind;
  const isOfficial = kind === "official";
  const set = <K extends keyof NewProjectInput>(k: K, v: NewProjectInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setContact = (k: keyof NewProjectInput["contact"], v: string) => setForm((f) => ({ ...f, contact: { ...f.contact, [k]: v } }));
  // with an uploaded 기존 사업계획서 the title/topic can be derived from the file + 변경 사항; the contact is always needed for the documents
  const contactOk = !!(form.contact.부서명.trim() && form.contact.전화.trim() && form.contact.이메일.trim());
  const recipientOk = recipientKind === "내부결재" || !!recipient.trim();
  const valid = isOfficial ? contactOk && recipientOk && !!(form.title.trim() && form.topic.trim()) : contactOk && (refFile ? true : !!(form.title.trim() && form.topic.trim()));
  const missing = isOfficial
    ? [
        ...(!form.title.trim() ? ["제목"] : []),
        ...(!recipientOk ? [RECIPIENT_KEY[recipientKind]] : []),
        ...(!form.topic.trim() ? ["공문 내용"] : []),
        ...(!form.contact.부서명.trim() ? ["부서명"] : []),
        ...(!form.contact.전화.trim() ? ["전화"] : []),
        ...(!form.contact.이메일.trim() ? ["이메일"] : []),
      ]
    : [
        ...(!refFile && !form.title.trim() ? ["제목"] : []),
        ...(!refFile && !form.topic.trim() ? ["주제"] : []),
        ...(!form.contact.부서명.trim() ? ["부서명"] : []),
        ...(!form.contact.전화.trim() ? ["전화"] : []),
        ...(!form.contact.이메일.trim() ? ["이메일"] : []),
      ];

  /**
   * 공문의 수신유형·수신은 DB 컬럼이 아니라 주제(topic)에 실려 프롬프트로 간다(스펙 §5.4).
   * front-matter 키 이름을 그대로 앞에 붙여 두면 `수신유형`·`수신`(수신유형=수신자)은 에이전트가
   * 옮겨 적기만 하면 된다. **`수신자`(수신유형=수신자참조)는 다르다** — 여기서는 화면 입력을
   * 그대로 이어 쓴 쉼표 목록(`recipient.trim()`)이라, 에이전트가 그걸 `OfficialMetaSchema` 가
   * 요구하는 YAML 배열(`수신자: [경영지원팀장, 마케팅팀장, …]`)로 바꿔 써야 한다 — 옮겨 적기만
   * 하면 배열이 아니라 문자열 하나가 되어 스키마를 통과하지 못한다.
   */
  const officialTopic = () => {
    const key = RECIPIENT_KEY[recipientKind];
    const head = [`수신유형: ${recipientKind}`, ...(key ? [`${key}: ${recipient.trim()}`] : [])];
    return `${head.join("\n")}\n\n${form.topic.trim()}`;
  };

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const contact = { ...form.contact };
      if (!contact.담당자?.trim()) delete contact.담당자;
      if (!contact.우편주소?.trim()) delete contact.우편주소;
      setPhase("create");
      const baseName = !isOfficial && refFile ? refFile.name.replace(/\.[A-Za-z0-9]+$/, "") : "";
      const title = form.title.trim() || baseName;
      const topic = isOfficial ? officialTopic() : form.topic.trim() || (refFile ? `기존 사업계획서(${refFile.name})를 기준으로 갱신${changes.trim() ? ` — 바뀌는 내용: ${changes.trim()}` : ""}` : "");
      const p = await api.createProject({ ...form, title, topic, contact });
      if (!isOfficial && refFile) {
        setPhase("upload");
        await api.uploadReference(p.id, refFile, changes, autoRun, planResearch);
      }
      onCreated(p);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="새 프로젝트"
      description={KIND_HINT[kind]}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            취소
          </Button>
          {!valid ? <span className="mr-2 self-center text-[11px] text-slate-500">입력 필요: {missing.join(", ")}</span> : null}
          <Button variant="primary" onClick={() => void submit()} disabled={!valid} loading={busy} title={valid ? undefined : `입력 필요: ${missing.join(", ")}`}>
            {phase === "upload" ? "업로드·분석 중…" : !isOfficial && refFile && autoRun ? "만들고 자동 실행" : "만들기"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="종류">
          <div className="flex flex-wrap gap-2">
            {PROJECT_KINDS.map((k) => (
              <label
                key={k}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs",
                  kind === k ? "border-sky-500 bg-sky-50 text-sky-900" : "border-slate-300 text-slate-700 hover:bg-slate-50",
                )}
              >
                <input type="radio" name="kind" className="h-3.5 w-3.5" checked={kind === k} onChange={() => set("kind", k)} />
                <span className="font-semibold">{KIND_LABEL[k]}</span>
                <span className="text-slate-500">{KIND_HINT[k]}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="제목" required={isOfficial || !refFile} hint={!isOfficial && refFile ? "비우면 파일 이름을 제목으로 씁니다" : isOfficial ? "공문의 제목 칸에 그대로 들어갑니다" : undefined}>
          <Input
            placeholder={isOfficial ? "예) 경영평가 대응을 위한 2026년 사업 추진 현황 제출 요청" : "예) 2026년 안동시 수출기업 역량강화 지원사업"}
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            autoFocus
          />
        </Field>
        {isOfficial ? (
          <>
            <div className="grid grid-cols-[10rem_1fr] gap-4">
              <Field label="수신유형" required>
                <Select value={recipientKind} onChange={(e) => setRecipientKind(e.target.value as RecipientKind)}>
                  {RECIPIENT_KINDS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </Select>
              </Field>
              {recipientKind === "내부결재" ? (
                <div className="self-end pb-2 text-[11px] text-slate-500">내부결재는 수신 대상 없이 &ldquo;내부결재&rdquo;로 찍힙니다.</div>
              ) : (
                <Field label={RECIPIENT_KEY[recipientKind]} required hint={recipientKind === "수신자참조" ? "여럿이면 쉼표로 구분" : "예: 경상북도지사"}>
                  <Input
                    placeholder={recipientKind === "수신자참조" ? "경영지원팀장, 마케팅팀장, 일자리종합지원팀장" : "경상북도지사"}
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                  />
                </Field>
              )}
            </div>
            <Field label="공문 내용" required hint="자유 서술 — 용건, 근거, 기한, 제출 방법 등. 에이전트가 항목 위계를 세워 기안문으로 씁니다">
              <Textarea
                rows={5}
                placeholder="예) 경영평가 상시대응을 위해 각 팀의 2026년 사업 추진 현황을 매월 제출받으려 한다. 작성대상은 각 팀 전체 사업, 기준은 전월 말일 예산 집행액, 제출기한은 매월 5일까지."
                value={form.topic}
                onChange={(e) => set("topic", e.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="주제" hint={refFile ? "비우면 기존 계획서와 바뀌는 내용으로 채웁니다" : "자유 서술 — 목적, 대상, 지원 내용, 예산 규모 등"} required={!refFile}>
              <Textarea rows={5} placeholder="예) 안동시 소재 수출 유망 중소기업 20개사에 수출용 홍보물 제작·마케팅·디자인 개발을 기업당 최대 300만원 지원. 7월 공고, 8월 선정, 10월 말까지 지원." value={form.topic} onChange={(e) => set("topic", e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="지역" hint="예: 안동시">
                <Input value={form.region} onChange={(e) => set("region", e.target.value)} />
              </Field>
              <Field label="주관기관">
                <Input value={form.organizer} onChange={(e) => set("organizer", e.target.value)} />
              </Field>
            </div>
          </>
        )}
        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-600">{isOfficial ? "처리과·담당 연락처" : "담당 연락처"}</legend>
          {isOfficial ? <p className="mb-2 text-[11px] text-slate-500">부서명은 공문의 처리과가 되고(결재라인·발신명의가 여기서 정해집니다), 전화·이메일은 결문 연락처에 찍힙니다.</p> : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="부서명" required>
              <Input placeholder="북부지소" value={form.contact.부서명} onChange={(e) => setContact("부서명", e.target.value)} />
            </Field>
            <Field label="담당자">
              <Input placeholder="홍길동 팀장" value={form.contact.담당자 ?? ""} onChange={(e) => setContact("담당자", e.target.value)} />
            </Field>
            <Field label="전화" required>
              <Input placeholder="054-900-3801" value={form.contact.전화} onChange={(e) => setContact("전화", e.target.value)} />
            </Field>
            <Field label="이메일" required>
              <Input type="email" placeholder="gepa_north@naver.com" value={form.contact.이메일} onChange={(e) => setContact("이메일", e.target.value)} />
            </Field>
            <Field label="우편주소" className="col-span-2">
              <Input placeholder="경상북도 안동시 북순환로 387, 2층 경상북도경제진흥원" value={form.contact.우편주소 ?? ""} onChange={(e) => setContact("우편주소", e.target.value)} />
            </Field>
          </div>
        </fieldset>
        {isOfficial ? null : (
        <fieldset className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-600">기존 사업계획서로 시작 (선택)</legend>
          <p className="mb-2 text-[11px] text-slate-500">지난해 사업계획서(hwp·hwpx·pdf·docx)를 올리고 바뀌는 내용을 적으면, 그 계획서를 기준으로 조사 → 사업계획서 → 공고문 → 보도자료를 자동으로 만듭니다.</p>
          <div className="grid gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
              <Upload className="h-4 w-4 text-slate-400" />
              <span className="flex-1 truncate">{refFile ? `${refFile.name} (${Math.round(refFile.size / 1024)} KB)` : "파일 선택 — .hwp .hwpx .pdf .docx .md .txt"}</span>
              <input type="file" className="hidden" accept=".hwp,.hwpx,.pdf,.docx,.md,.txt" onChange={(e) => setRefFile(e.target.files?.[0] ?? null)} />
            </label>
            {refFile ? (
              <>
                <Field label="이번에 바뀌는 내용" hint="예) 2027년으로 연도 변경, 지원 규모 20개사 → 30개사, 기업당 한도 300만원 → 500만원, 접수 7월 → 8월">
                  <Textarea rows={3} value={changes} onChange={(e) => setChanges(e.target.value)} placeholder="연도·기간·규모·금액·담당 등 달라지는 점을 적어 주세요" />
                </Field>
                <div className="flex flex-wrap gap-4 text-xs text-slate-700">
                  <label className="flex items-center gap-1">
                    <input type="checkbox" className="h-3.5 w-3.5" checked={autoRun} onChange={(e) => setAutoRun(e.target.checked)} />
                    만든 뒤 조사부터 보도자료까지 자동 실행
                  </label>
                  <label className="flex items-center gap-1" title="사업계획서 작성 중 근거가 부족하면 조사 에이전트로 보충 조사합니다(최대 2회). 이 설정은 기억되어 이후 실행에도 적용됩니다">
                    <input type="checkbox" className="h-3.5 w-3.5" checked={planResearch} onChange={(e) => writePref(PREF_PLAN_RESEARCH, e.target.checked)} />
                    계획서 보충 조사
                  </label>
                </div>
              </>
            ) : null}
          </div>
        </fieldset>
        )}
        {error ? <p className="rounded bg-red-50 p-2 text-xs text-red-700">{error}</p> : null}
      </div>
    </Dialog>
  );
}

export function ProjectList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [toDelete, setToDelete] = useState<ProjectDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteProject(toDelete.id);
      setToDelete(null);
      setProjects((list) => (list ? list.filter((p) => p.id !== toDelete.id) : list));
    } catch (e) {
      setDeleteError(errorMessage(e));
    } finally {
      setDeleting(false);
    }
  };

  // fetch on mount and whenever the user asks for a refresh; state only changes in callbacks
  useEffect(() => {
    let active = true;
    api
      .listProjects()
      .then((list) => {
        if (!active) return;
        setProjects(list);
        setError(null);
      })
      .catch((e: unknown) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const reload = () => {
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">프로젝트</h1>
          <p className="mt-0.5 text-xs text-slate-500">사업 주제로 조사 노트·사업계획서·공고문·보도자료를 차례로 만들거나, 공문 한 건을 만듭니다.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={reload} loading={loading}>
            <RefreshCw className="h-3.5 w-3.5" /> 새로 고침
          </Button>
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> 새 프로젝트
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          프로젝트 목록을 불러오지 못했습니다: {error}
        </div>
      ) : null}

      {projects === null && !error ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : null}

      {projects && projects.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
          <FolderOpen className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-600">아직 프로젝트가 없습니다.</p>
          <Button className="mt-4" variant="primary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> 첫 프로젝트 만들기
          </Button>
        </div>
      ) : null}

      {projects && projects.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          {projects.map((p) => (
            <div key={p.id} className="relative rounded-lg border border-slate-200 bg-white transition-shadow hover:shadow-md">
              <Link href={`/projects/${p.id}`} className="block p-4 pr-12">
                <div className="flex items-center gap-2">
                  <Badge tone="neutral">{KIND_LABEL[p.kind]}</Badge>
                  <div className="min-w-0 truncate text-sm font-semibold text-slate-900">{p.title}</div>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-600">{p.topic}</p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  {p.kind === "program" ? (
                    <>
                      <span>지역 {p.region || "-"}</span>
                      <span>주관 {p.organizer || "-"}</span>
                    </>
                  ) : (
                    <span>처리과 {p.contact?.부서명 || "-"}</span>
                  )}
                  <span className="ml-auto">{formatDateTime(p.updatedAt || p.createdAt)}</span>
                </div>
              </Link>
              <button
                type="button"
                aria-label="프로젝트 삭제"
                title="프로젝트 삭제"
                className="absolute right-3 top-3 rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                onClick={() => {
                  setDeleteError(null);
                  setToDelete(p);
                }}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <Dialog
        open={!!toDelete}
        onClose={() => (deleting ? undefined : setToDelete(null))}
        title="프로젝트 삭제"
        description="작성된 문서와 실행 기록이 모두 지워지며 되돌릴 수 없습니다."
        footer={
          <>
            <Button variant="outline" onClick={() => setToDelete(null)} disabled={deleting}>
              취소
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} loading={deleting}>
              <Trash2 className="h-4 w-4" /> 삭제
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-800">
          <span className="font-semibold">{toDelete?.title}</span> 프로젝트를 삭제할까요?
        </p>
        {deleteError ? <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-700">{deleteError}</p> : null}
      </Dialog>

      {open ? (
        <NewProjectDialog
          onClose={() => setOpen(false)}
          onCreated={(p) => {
            setOpen(false);
            router.push(`/projects/${p.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
