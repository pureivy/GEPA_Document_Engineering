# GEPA Document Engineering — 구현 계획

## Context

경상북도경제진흥원(GEPA)의 공식 문서(사업계획서 → 공고문 → 보도자료)를 AI 에이전트 팀이 조사·작성하고,
결과를 **한글(HWPX) 파일**로 내보내는 웹앱을 새로 만든다. 프로젝트 디렉터리는 비어 있다(greenfield).

핵심 요구사항(사용자):
1. 주제 조사 → **사업계획서** HWPX. 참고 사업계획서 5종의 디자인 시스템(폰트·줄간격·자간·문서체계·들여쓰기)을 그대로 따른다.
2. 사업계획서 → **공고문** HWPX. `6-1. [붙임1] …참여기업 모집 공고안(수ᄎ.hwp`의 디자인 시스템을 그대로 따른다.
3. 공고문 → **보도자료**.
4. **웹앱**에서 한글 작업 과정이 실시간으로 보이고, 웹에서 수정 후 HWPX로 저장 가능.

사용자 결정:
- 스택: **Next.js + Claude Code CLI**(로컬 설치 `claude` 2.1.271, **구독 로그인 재사용**). **Claude API / Agent SDK / ANTHROPIC_API_KEY는 사용하지 않는다** — 모든 LLM 호출은 `claude -p` 서브프로세스로만 수행.
- 조사: Claude Code CLI의 WebSearch/WebFetch
- 편집기: HWPX 스타일을 재현한 **자체 페이지형 에디터**
- 저장: **로컬 파일시스템 + SQLite**

## 사전 조사 결과 (실제 실행·검증됨)

상세 보고서 4건 — 구현 시 `docs/design-system/`으로 복사해 에이전트 스킬의 원천으로 사용:
- 사업계획서 디자인 시스템: `~/.claude/plans/streamed-twirling-deer-agent-aplan-analysis-ffa4ca614cb10427.md`
- 공고문(6-1) 디자인 시스템 + 플레이스홀더 템플릿(§8): `~/.claude/plans/streamed-twirling-deer-agent-anotice-analysis-040a281980a0e0eb.md`
- HWPX 툴링 조사/실측(§8 실행 결과): `~/.claude/plans/streamed-twirling-deer-agent-ahwpx-research-71e7d11912209ff8.md`
- **아키텍처 상세 설계(파일 트리·DocModel·DSL·HWPX writer·에이전트·UI·마일스톤 검증 명령 전문)**: `~/.claude/plans/streamed-twirling-deer-agent-aarch-plan-02e140bad38716e2.md` ← 구현 시 이 문서를 스펙으로 따른다. 아래는 요약 + 수정사항.

핵심 사실:
- **HWP→HWPX 변환은 `rhwp` CLI(Rust, MIT, macOS arm64 바이너리 v0.8.6)**로 가능. 6-1 공고문은 `--verify` 통과, render-diff 0.00px, PDF 바이트 동일. 사업계획(안)은 그룹 도형 때문에 레이아웃 캐시 차이 발생(폰트/스타일/표 메타데이터는 100% 보존) → 사업계획서는 header.xml(스타일)만 취하고 본문(section0.xml)은 새로 생성.
- **`@rhwp/core`(npm, WASM 9.9MB)는 Node에서 hwpx 로드·편집·저장·SVG 렌더 가능**(contentLoss 0 확인). 단일 TypeScript 스택 성립. Python 불필요.
- LibreOffice는 HWP5/HWPX 모두 불가. Hancom Office는 macOS 자동화 API 없음 → **한글에서 열림 확인은 수동 게이트**.
- `@rhwp/editor`는 서드파티 호스트(iframe)로 문서를 전송 → 사용 금지.
- HWPX 실제 네임스페이스 `http://www.hancom.co.kr/hwpml/2011/{head,paragraph,section,core}`, 루트 `hs:sec`, mimetype `application/hwp+zip`(첫 엔트리, 무압축). 병합셀은 anchor `hp:tc`만 존재(`hp:cellSpan`). 하이퍼링크는 `hp:fieldBegin type="HYPERLINK"` 필드. `linesegarray`는 근사값 1개로 충분(rhwp 자체 writer도 동일).
- 디자인 시스템 핵심: 들여쓰기는 **여백이 아니라 앞 공백 문자**(공고: □0 ㅇ1 -3 ※2 *4 / 계획: □1 ㅇ2 -3 ·4 ※1). 장 제목은 **1×3 표(네이비 #003366 칩, 폭 2990/560/44560)**, 절 제목은 1×2 칩(#203a7b + #d9d9d9). 공고문 섹션바는 **2×1 표 + #47b0bb→#d0eaed 그라데이션 띠(1.70mm, 표 높이 3330)**. 본문 휴먼명조 13pt(공고)/15pt(계획), 제목 HY헤드라인M, 표 맑은 고딕, 주석 한양중고딕 12pt, 줄간격 비율 160%(계획서 135~180%). 표 헤더 채움 #d9d9d9(계획)/#dfe6f7(공고). 명명 스타일 미사용(모두 바탕글 + 직접서식).
- 로컬 실제 폰트: 휴먼명조(`Hnc/Shared/TTF/Hwp/HMKMM.TTF`), HY헤드라인M(`All/H2HDRM.TTF`), 맑은 고딕(`Install/malgun.ttf`), 굴림(`Install/Gulim.TTF`) — Hancom Office 번들 내. 한양중고딕·돋움·HCI Poppy 없음 → Noto 대체.
- `claude -p` headless: `--output-format stream-json --verbose --include-partial-messages --permission-mode bypassPermissions --allowedTools … --session-id/--resume --max-turns --json-schema --append-system-prompt`; 서브에이전트는 cwd의 `.claude/agents/*.md`; 메시지에 `parent_tool_use_id`로 서브에이전트 활동 구분.

## 아키텍처 (요약)

```
[Next.js 15 App Router, pnpm, TS]                       data/ (gitignored)
 app/ (UI + API routes, nodejs runtime)                  ├ gepa.db (SQLite: projects, runs, run_events, doc_versions)
 lib/agents   ClaudeCliRunner (spawn claude -p) ─SSE─▶   └ projects/<id>/{research,plan,notice,press}/
 lib/docmodel DSL(마크다운 변형) → DocModel(zod JSON)          draft.dsl.md, doc.json, out.hwpx, render/*.svg
 lib/hwpx     template-preserving writer + @rhwp/core 검증/렌더
 templates/{notice,plan,press}/  curated header.xml + geometry/*.json + style-map.json + golden DSL
 agent/       claude 서브프로세스의 cwd: agent/.claude/{agents,skills} + CLAUDE.md (개발자 세션에 섞이지 않게 분리)
 scripts/     setup-rhwp, setup-fonts, curate-template, extract-style-map, extract-geometry, golden, dev-agent-smoke
 docs/design-system/  3개 분석 보고서 원문
```

### 1) 문서 파이프라인 데이터 흐름
주제 입력 → **조사**(`research/notes.md` + `sources.json`) → **사업계획서**(DSL → DocModel → HWPX) → **공고문**(계획서 DSL을 입력으로, 6-1 골격 채움) → **보도자료**(HWPX + .md/.txt). 각 단계 후 `reviewer`가 `--json-schema`로 이슈 목록을 내고, "자동 수정"은 `--resume <session>`.

### 2) DocModel / DSL (상세: 설계문서 §B)
- `DocModel {version, family: 'plan'|'notice'|'press', meta, blocks[]}`. 블록: `para(role, glyph, inlines)`, `blank`, `pageBreak`, `image`, `table(role, widthsPt, rows, style)` + 가족별 합성 블록 `chapterBand`, `sectionChip`, `summaryBox`, `approvalBlock`, `coverTitle`(계획) / `sectionBar`, `infoBox`, `overviewTable`, `procedureFlow`, `noticeHeader`(공고) / `pressHeader`(보도).
- DSL: YAML front-matter(메타: 공고번호·사업명·접수처·모집개요표 행·절차도 단계 등) + 본문. `#`=장(밴드/섹션바), `##`=절 칩, 행 첫 글자(□ ㅇ - · ※ *)로 역할 결정(모델은 공백 수를 셀 필요 없음, 파서가 표준 들여쓰기 적용), GFM 표(`^`=위와 병합, `<`=왼쪽과 병합, `{table role=budget widths=…}` 속성행), ` ```box/flow/image/attach ` 펜스, `<pagebreak>`, **고정 문구는 `{{boilerplate:참여제제한대상}}` 매크로로만 삽입**(모델이 바꿔쓰지 못하게, `기업게좌` 오타 포함 원문 보존).
- 공고문 DSL은 6-1 골격 fill-in: 표지 블록·안내박스·1.모집개요표·2.지원절차 절차도는 메타에서 **합성**, 3번 섹션부터 자유 작성.
- 스트리밍 파서: 청크 단위 입력 → `block.open / text.delta / block.upsert / block.commit` 이벤트 → 에디터가 타이핑 애니메이션.

### 3) HWPX writer (상세: 설계문서 §C)
- 템플릿 보존: `templates/<family>/`에 rhwp로 변환·검증한 `header.xml`, `content.hpf`, `version.xml`, `settings.xml`, `META-INF/*`, `BinData/*`(로고 image1.png, 화살표 image2.jpg), 첫 문단의 `secPr/colPr/pageNum` fragment를 그대로 두고 **section0.xml만 생성**.
- `style-map.json`: 역할→`{paraPr, charPr}` id, 역할→`borderFill` id, 카탈로그(시그니처). `StyleRegistry`가 미등록 시그니처만 header.xml 끝에 **append**(itemCnt 갱신) — 유일한 header 변형.
- 표: (a) 하우스 합성표(섹션바, 안내박스, 모집개요표, 절차도, 장 밴드, 절 칩, 결재란, 예산표 헤더 등)는 `geometry/*.json` 스냅샷을 **재생**(속성 verbatim, 텍스트 치환, 프로토타입 행 복제) (b) 일반 표는 `widthsPt`·`TableStyle`로 생성(합계 폭 48190, 병합은 anchor+cellSpan, 셀 폭/높이 합산).
- 검증: `@rhwp/core` 로드 → `exportHwpxWithReport().contentLoss().count===0` → `renderPageSvg` → XML well-formed → zip 순서/mimetype; 테스트에서 `bin/rhwp verify/render-diff/export-pdf`. 미검증 문서는 다운로드 차단.
- 렌더: 서버에서 페이지별 SVG 캐시(내용 해시). `fonts.css`가 SVG의 한글 폰트명(휴먼명조, HY헤드라인M, 맑은 고딕)과 동일한 family명으로 `@font-face` 선언.

### 4) 에이전트 (상세: 설계문서 §D)
- `ClaudeCliRunner`: `spawn(CLAUDE_BIN, ['-p','--verbose','--output-format','stream-json','--include-partial-messages','--permission-mode','bypassPermissions','--allowedTools',…,'--session-id',uuid,'--model','opus','--max-turns',n,'--append-system-prompt',…,'--add-dir',workspace], {cwd: 'agent/'})`, env에서 `CLAUDECODE*` 제거(중첩 세션 가드), stdin으로 프롬프트. NDJSON → `AgentEvent`(init/text.delta/tool.start/tool.result/subagent.start/end/result/stderr) → SQLite `run_events` 저장 + SSE 브로드캐스트(`Last-Event-ID` 재생).
- **각 단계의 메인 프로세스가 작성자 페르소나**(문서 텍스트가 최상위 `text_delta`로 스트리밍되도록), 조사는 `Task(researcher)` 서브에이전트. 문서는 `<<<DOC … DOC>>>` 마커 안에 출력 + Write로 `draft.dsl.md` 저장(대체 스트림).
- **모델: 하이브리드(2026-09-16 변경, 사용자 결정)** — 조사(종합)·사업계획서 `opus`, 공고문·보도자료·검토 `sonnet`(`lib/agents/limits.ts` `STAGE_MODELS`, 실행 단위 선택·`GEPA_MODEL_<STAGE>` 재정의 가능). 처음에는 모든 실행이 `--model opus`였으나 주간 사용량 한도 소진(2026-09-15)으로 전환. `agent/.claude/agents/`: `researcher`(sonnet, WebSearch/WebFetch — 실제로 Task로 생성되는 유일한 하위 에이전트), `plan-writer`(opus), `notice-writer`(sonnet), `press-writer`(sonnet), `reviewer`(sonnet, json-schema). `agent/.claude/skills/`: `gepa-dsl`(문법+예제), `gepa-plan-design`(정본 목차·레벨·표 규격), `gepa-notice-design`(6-1 골격·보일러플레이트·섹션 순서), `gepa-press-style`, `gepa-research`(출처 계층, `(출처, 연도)` 인용 강제).
- 한도: 단계별 `--max-turns`(조사 40 / 계획 60 / 공고 30 / 보도 20 / 검토 10), wall/idle 타임아웃, 취소 시 프로세스 그룹 kill. **비용 표시는 달러가 아니라 턴 수·경과시간·토큰**(구독이라 `total_cost_usd`는 참고값).
- `claude` 미설치/로그아웃 감지 시 UI에 `claude login` 안내.

### 5) 웹 UI (상세: 설계문서 §E)
- `/` 프로젝트 목록·생성(주제, 지역/주관기관, 담당 연락처) → `/projects/[id]` 파이프라인 바(4 단계 카드) → `/projects/[id]/[stage]` **3-pane**: 좌 `AgentActivityLog`(도구 호출 칩, 서브에이전트 중첩 로그, 턴/시간) / 중 `HwpEditor`(TipTap, DocModel 1:1 커스텀 노드, A4 210mm 페이지 프레임, 실제 폰트, 그라데이션 바·밴드 CSS 재현, `white-space: pre-wrap`으로 앞 공백 유지) / 우 `RenderPane`(HWPX 실제 SVG 렌더 + 검증 배지).
- 타이핑 애니메이션 `TypingController`: 파서 이벤트 큐 → 6–12ms/char, 백로그 400자 초과 시 40자 청크 드레인, 표는 행 단위, 자동 스크롤·캐럿, 실행 중 읽기전용, "건너뛰기" 버튼.
- 편집 → 저장: `onUpdate`(800ms 디바운스) → `fromPm` → zod → `PUT /doc` → `doc_versions` → 자동 export → 렌더 갱신. 메타는 사이드 시트 폼. `DownloadBar`: HWPX / PDF(`rhwp export-pdf --font-path`) / 보도자료 .md·.txt / 버전 기록·복원.

## 구현 마일스톤 (각 단계 검증 명령은 설계문서 §F)

| M | 범위 | 게이트 |
|---|---|---|
| **M0** 스캐폴드·템플릿 큐레이션·폰트 | `create-next-app`, shadcn, Drizzle+better-sqlite3, vitest; `scripts/setup-rhwp`(v0.8.6 다운로드), `setup-fonts`(Hancom 번들 TTF → `public/fonts`, gitignore + LICENSE-NOTE, Noto 폴백 커밋), `curate-template notice|plan`(export-hwpx --verify → render-diff → unzip → rhwp 마커 제거), `extract-style-map`, `extract-geometry`; `docs/design-system/` 복사; `agent/.claude` 골격 | notice render-diff PASS; style-map charPr 128; sectionBar geometry 표 높이 3330 |
| **M1** 공고문 HWPX writer | `lib/hwpx/*` 전부 + DSL 파서(비스트리밍) + notice expander/boilerplate + 수기 전사 `golden/6-1.dsl.md` | 골든 빌드: contentLoss 0, 7페이지, export-text 원본과 동일, 추가 스타일 0, render-diff PASS(≤2px), **한글에서 열림(수동)**, lineseg 생략 vs 근사 A/B → ADR |
| **M2** 사업계획서·보도자료 writer | plan geometry(결재란, 장 밴드, 절 칩, 요약 박스, 예산/일정표), `writers/plan.ts`, `writers/press.ts`, 골든 `file5.dsl.md`(그룹 도형 요약 프레임은 칩 표로 재표현) | contentLoss 0, 14±1p, 밴드 셀 폭 2990/560/44560, export-png 육안 확인, 한글 열림 |
| **M3** 에이전트 러너·SSE·조사 단계 | `lib/agents/*`, DB 스키마, API routes, agents/skills 확정, `dev-agent-smoke.ts` | 스모크 실행에 init/tool/result 이벤트; stream-json 픽스처 테스트; SSE 재접속 재생; 취소 시 프로세스 종료 |
| **M4** 에디터·타이핑·렌더 | TipTap 노드, `toPm/fromPm`, TypingController, 스트리밍 파서, RenderPane, fonts.css | `fromPm(toPm(doc))` 동일성; 1–40자 랜덤 청크 파싱 = 일괄 파싱; Playwright 재생 테스트; 편집→저장→다운로드→한글 열림 |
| **M5** 파이프라인 3단계 연결 | 프롬프트/스킬 튜닝, 단계 입력 배선(`toDsl`), reviewer + 자동수정(`--resume`), DownloadBar/PDF | 한 주제 E2E 4단계 완주, 모든 산출물 validate 통과, 보일러플레이트 바이트 동일, reviewer error 0 |
| **M6** 마감 | 버전 이력 UI, 메타 폼, 오류 표면, 렌더 캐시, Preview PNG, e2e, README/ADR, `FieldFormula`·중첩 평가표(선택) | `pnpm typecheck && lint && vitest && playwright` 통과; 서버 재시작 복구 |

## 가정 (질문 없이 진행하는 판단)
- 사업계획서 1차 참조 템플릿 = `6. 2026년 안동시 수출기업 역량강화 지원사업 사업계획(안).hwp`(가장 최신, 6-1 공고문과 같은 사업). 하우스 스타일은 파일 2/4/5 다수결(로마자 장 밴드, 휴먼명조 15pt, 160%). 파일 3(한국어·경북학)은 이형으로 제외.
- 사업계획서에는 참고문서 5종 모두에 있는 결재란·표지 제목을 포함.
- 보도자료는 HWPX(공고문 header.xml 재사용, 머리표 + 제목/부제/리드/본문/담당자) + .md/.txt로 출력.
- 폰트 파일 복사는 이 Mac(한컴오피스 정품 설치)에서 로컬 미리보기 용도로만 사용하며 저장소에 커밋하지 않음. HWPX에는 폰트를 임베드하지 않음(`isEmbedded="0"`).
- 참고 `.hwp` 원본은 `templates/<family>/reference.hwp`로 복사만 하며 Desktop 원본은 수정하지 않음.

## 주요 리스크
- 한글 정식 열림 검증은 수동(각 마일스톤 게이트에 포함). 실패 시 `--lineseg omit|approx|roundtrip`, `HWPX_PLAIN_LINKS` 스위치로 빠르게 대응.
- 사업계획서 참조는 그룹 도형 때문에 render-diff가 참고용; 페이지별·PNG 육안 확인이 게이트.
- 모델의 DSL 이탈(글리프·보일러플레이트 변형): 파서 정규화 + 매크로 강제 + reviewer.
- 통계 날조: `gepa-research` 스킬이 숫자마다 출처 요구, reviewer가 무출처 숫자 플래그.

## 첫 실행 순서 (M0 착수)
1. `pnpm create next-app@latest . --ts --app --tailwind --eslint --src-dir=false --import-alias "@/*" --use-pnpm` → shadcn init → 의존성(`@rhwp/core`, `fflate`, `fast-xml-parser`, `better-sqlite3`, `drizzle-orm`, `zod`, `yaml`, `@tiptap/*`, `react-resizable-panels`, `vitest`, `tsx`).
2. `scripts/setup-rhwp.ts`, `scripts/setup-fonts.ts` 작성·실행.
3. Desktop 참고 파일 2종을 `templates/{notice,plan}/reference.hwp`로 복사 → `curate-template` → `extract-style-map` → `extract-geometry`.
4. 보고서 4건을 `docs/design-system/`로 복사, `agent/.claude/skills`에 요약 반영.

## 진행 상태 (2026-09-15)
- M0~M6 완료. M5: 4단계 E2E 완주 + reviewer 실행·`자동 수정`(--resume) UI 연결·실행 확인. M6: 버전 이력·메타 폼·오류 표면·렌더 캐시·README·ADR 0001~0004 + Playwright e2e(`pnpm test:e2e`, 재생 픽스처) + Preview PNG(1쪽 200px 래스터) + FieldFormula(합계 행 `=SUM`) + 중첩 평가표(배점 구간 줄 → 2×N 중첩 표, 참조 카탈로그 스타일 그대로, 추가 스타일 0) + 다시 쓰기(rewrite) 처리. 한글 열림 재확인(골든·에이전트 작성 공고문).
- 알려진 제한: 중첩 배점표는 HWPX/렌더에서만 표가 되고 편집기에서는 한 줄 텍스트로 보인다(DocModel은 평문 유지).
- 실측: 실제 `claude -p`로 4단계 완주(조사 15+53턴, 사업계획서 13쪽, 공고문 7쪽, 보도자료 2쪽). 한글 열림 확인: 공고문·범피스 프로필·사업계획서(ADR 0004 수정 후)·보도자료.
- 검토관: 공고문 점수 72, 이슈 9건(JSON) → 자동 수정으로 매크로·확정 날짜 반영. 지적된 "고정문구 직접 타이핑" 5건은 에디터가 로드 직후 저장하며 매크로를 풀어 쓴 것이 원인이었음 → 에디터 dirty 판정 수정(`docChanged`만) + `toDsl` 매크로 재접기.
- 실시간 타이핑 채널을 `Write` 도구 입력 스트림으로 전환(문서 2회 출력 제거). 단계별 wall/idle 타임아웃이 `undefined` 덮어쓰기로 무효였던 버그 수정.
- 추가: 범정부오피스(범피스) 프로필 `house: bumpis`, 공문 표기 유틸(`lib/docmodel/format.ts`).
- 알려진 이슈: 조사 단계는 17~20분·13턴 이상 걸려 구독 세션 한도에 걸리기 쉬움(한도 도달 시 `You've hit your session limit` 로 실패, 재개 가능). 하위 에이전트 배경 실행 시 메인 조기 종료 → `background: false` + 완료 조건 명시로 완화, 미생성 시 UI에 안내.
