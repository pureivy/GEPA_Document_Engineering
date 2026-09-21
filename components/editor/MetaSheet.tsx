"use client";
/**
 * MetaSheet — side sheet form for the family meta (공고번호, 접수, 결재 …). The form is derived
 * from the meta object itself: scalars become inputs, nested objects become fieldsets,
 * string arrays a one-per-line textarea, object arrays a JSON textarea. Saved values are
 * validated with the family's zod schema.
 */
import { useMemo, useState } from "react";
import { z } from "zod";
import type { DocModel, Family } from "@/lib/docmodel/schema";
import { NoticeMetaSchema, OfficialMetaSchema, PlanMetaSchema, PressMetaSchema } from "@/lib/docmodel/schema";
import { Sheet } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";

const SCHEMAS: Record<Family, z.ZodType> = { notice: NoticeMetaSchema, plan: PlanMetaSchema, press: PressMetaSchema, official: OfficialMetaSchema };

/** field order + labels for fields the schema knows; unknown keys are appended */
const ORDER: Record<Family, string[]> = {
  notice: ["공고번호", "사업명", "모집대상", "부제", "주관기관", "지역", "대상기업군", "공고연월", "기관장", "접수", "모집개요", "절차도", "로고", "lineSpacing", "paraSpacing"],
  plan: ["제목", "부제", "연도", "부서", "등록번호", "결재", "요약", "numbering", "lineSpacing", "body1Font", "house"],
  press: ["기관", "배포일", "보도시점", "담당부서", "책임자", "담당자", "연락처", "이메일", "제목", "부제", "사진", "붙임"],
  official: ["수신유형", "수신", "수신자", "경유", "제목", "발신명의", "처리과", "시행일", "공개구분", "결재라인", "협조자", "연락처", "붙임"],
};

/** blank template so a document without meta still shows the right fields */
const TEMPLATE: Record<Family, Record<string, unknown>> = {
  notice: {
    공고번호: "",
    사업명: "",
    모집대상: "참여기업",
    부제: "",
    주관기관: "",
    지역: "",
    대상기업군: "중소기업",
    공고연월: "",
    기관장: "(재)경상북도경제진흥원장",
    접수: { 이메일: "", 우편주소: "", 부서명: "", 전화: "", 선정결과통보: "기업별 개별통보(필요시 접수 홈페이지 공고)" },
    모집개요: [],
    절차도: [],
    로고: true,
    lineSpacing: 160,
    paraSpacing: "plan",
  },
  plan: {
    제목: "",
    부제: "",
    연도: "",
    부서: "",
    등록번호: "",
    결재: { 담당: "", 팀장: "", 실장: "", 본부장: "", 원장: "", 등록일자: "", 결재일자: "", 공개구분: "", 협조: "" },
    요약: { 사업개요: "", 추진일정: "", 기대효과: "" },
    numbering: "roman",
    ladder: "gov",
    lineSpacing: 160,
    body1Font: "humanMyeongjoBold",
    house: "gepa",
  },
  press: { 기관: "(재)경상북도경제진흥원", 배포일: "", 보도시점: "즉시", 담당부서: "", 책임자: "", 담당자: "", 연락처: "", 이메일: "", 제목: "", 부제: "", 사진: false, 붙임: [] },
  official: {
    수신유형: "내부결재",
    수신: "",
    수신자: [],
    경유: "",
    제목: "",
    발신명의: "",
    처리과: "",
    시행일: "",
    공개구분: "공개",
    결재라인: [],
    협조자: [],
    연락처: { 우편번호: "", 주소: "", 홈페이지: "https://gepa.kr", 전화: "", 전송: "", 이메일: "" },
    붙임: [],
  },
};

type Draft = Record<string, unknown>;

function toDraft(family: Family, meta: unknown): Draft {
  const base = JSON.parse(JSON.stringify(TEMPLATE[family])) as Draft;
  const m = (meta && typeof meta === "object" ? meta : {}) as Draft;
  for (const [k, v] of Object.entries(m)) {
    if (v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])) base[k] = { ...(base[k] as Draft), ...(v as Draft) };
    else base[k] = v;
  }
  return base;
}

/** drop empty strings so optional fields validate; keep required defaults */
function compact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(compact);
  if (v && typeof v === "object") {
    const out: Draft = {};
    for (const [k, x] of Object.entries(v as Draft)) {
      if (x === "" || x === undefined) continue;
      out[k] = compact(x);
    }
    return out;
  }
  return v;
}

export interface MetaSheetProps {
  open: boolean;
  family: Family;
  meta: DocModel["meta"] | null;
  onClose: () => void;
  onSave: (meta: DocModel["meta"]) => void;
}

export function MetaSheet({ open, family, meta, onClose, onSave }: MetaSheetProps) {
  // mounted fresh each time it is opened (HwpEditor renders it only while open)
  const [draft, setDraft] = useState<Draft>(() => toDraft(family, meta));
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const keys = useMemo(() => {
    const known = ORDER[family].filter((k) => k in draft);
    const extra = Object.keys(draft).filter((k) => !known.includes(k));
    return [...known, ...extra];
  }, [draft, family]);

  const set = (path: string[], value: unknown) => {
    setDraft((d) => {
      const next = JSON.parse(JSON.stringify(d)) as Draft;
      let cur: Draft = next;
      for (const p of path.slice(0, -1)) cur = cur[p] as Draft;
      cur[path[path.length - 1]] = value;
      return next;
    });
  };

  const save = () => {
    if (Object.keys(jsonErrors).length) {
      setError("JSON 형식 오류가 있는 항목을 먼저 고쳐 주세요.");
      return;
    }
    const res = SCHEMAS[family].safeParse(compact(draft));
    if (!res.success) {
      setError(res.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n"));
      return;
    }
    onSave(res.data as DocModel["meta"]);
    onClose();
  };

  const renderField = (key: string, value: unknown, path: string[]): React.ReactNode => {
    const label = path.length > 1 ? `${path.slice(0, -1).join(".")} › ${key}` : key;
    if (typeof value === "boolean") {
      return (
        <label key={path.join(".")} className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={value} onChange={(e) => set(path, e.target.checked)} />
          {label}
        </label>
      );
    }
    if (typeof value === "number") {
      return (
        <Field key={path.join(".")} label={label}>
          <Input type="number" value={value} onChange={(e) => set(path, e.target.value === "" ? "" : Number(e.target.value))} />
        </Field>
      );
    }
    if (typeof value === "string") {
      const long = value.length > 60;
      return (
        <Field key={path.join(".")} label={label}>
          {long ? <Textarea value={value} onChange={(e) => set(path, e.target.value)} /> : <Input value={value} onChange={(e) => set(path, e.target.value)} />}
        </Field>
      );
    }
    if (Array.isArray(value)) {
      const allStrings = value.every((x) => typeof x === "string");
      if (allStrings) {
        return (
          <Field key={path.join(".")} label={label} hint="한 줄에 하나">
            <Textarea
              value={(value as string[]).join("\n")}
              onChange={(e) =>
                set(
                  path,
                  e.target.value
                    .split("\n")
                    .map((s) => s.trim())
                    .filter(Boolean),
                )
              }
            />
          </Field>
        );
      }
      const k = path.join(".");
      return (
        <Field key={k} label={label} hint="JSON 배열">
          <Textarea
            className="font-mono text-xs"
            defaultValue={JSON.stringify(value, null, 2)}
            onChange={(e) => {
              try {
                const parsed = JSON.parse(e.target.value);
                setJsonErrors((j) => {
                  const n = { ...j };
                  delete n[k];
                  return n;
                });
                set(path, parsed);
              } catch {
                setJsonErrors((j) => ({ ...j, [k]: "JSON 형식 오류" }));
              }
            }}
          />
          {jsonErrors[k] ? <p className="mt-1 text-xs text-red-600">{jsonErrors[k]}</p> : null}
        </Field>
      );
    }
    if (value && typeof value === "object") {
      return (
        <fieldset key={path.join(".")} className="rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-xs font-semibold text-slate-600">{key}</legend>
          <div className="grid gap-3">{Object.entries(value as Draft).map(([ck, cv]) => renderField(ck, cv, [...path, ck]))}</div>
        </fieldset>
      );
    }
    return null;
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="문서 메타 정보"
      description="머리글·결재란 등 자동 생성 블록의 원본 값입니다. 저장하면 문서가 다시 저장·렌더됩니다."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={save}>
            적용
          </Button>
        </>
      }
    >
      <div className="grid gap-3">{keys.map((k) => renderField(k, draft[k], [k]))}</div>
      {error ? <pre className="mt-3 whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-700">{error}</pre> : null}
    </Sheet>
  );
}
