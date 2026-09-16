# GEPA Document Engineering

경상북도경제진흥원(GEPA) 공식 문서를 AI 에이전트 팀이 **조사 → 사업계획서 → 공고문 → 보도자료** 순으로
작성하고, 결과를 참고 문서의 디자인 시스템을 그대로 따른 **한글(HWPX)** 파일로 내보내는 웹앱.
한글 작업 과정이 브라우저에서 실시간으로 보이고, 웹에서 수정한 뒤 HWPX/PDF로 저장할 수 있다.

## 요구 사항
- **macOS, Windows 10/11, Linux** 중 하나 · Node 22 · pnpm 10 (개발·검증은 macOS Apple Silicon에서 했고, Windows·Linux는 아래 절차대로 설치하면 동작하도록 만들었으나 실기 확인은 아직 macOS뿐이다)
- **Claude Code CLI**(구독 로그인, `claude login` 1회). Claude API 키는 사용하지 않는다.
- **rhwp CLI**(HWP→HWPX 변환, PDF 내보내기): https://github.com/edwardkim/rhwp/releases 의 v0.8.6 실행 파일 — macOS `rhwp`, Windows `rhwp.exe`, Linux `rhwp` — 를 `bin/`에 둔다(또는 `RHWP_BIN`으로 경로 지정).
- **poppler `pdftotext`**(선택: PDF 사업계획서 업로드용) — macOS `brew install poppler`, Windows는 poppler 릴리스를 풀고 PATH 또는 `PDFTOTEXT_BIN`에 지정, Linux `apt install poppler-utils`.
- 한컴오피스 한글(선택: 실제 폰트 미리보기 및 최종 열림 확인용). 폰트가 없으면 브라우저 미리보기만 노토 글꼴로 대체되고 생성되는 HWPX는 영향이 없다.

## 설치
```bash
pnpm install
pnpm tsx scripts/setup-fonts.ts          # 설치된 한컴 폰트 → public/fonts (로컬 미리보기용, git 제외; OS별 폰트 폴더를 자동 검색)
# bin/rhwp(.exe) : https://github.com/edwardkim/rhwp/releases 의 실행 파일을 bin/에 복사
pnpm setup:templates                     # hwp→hwpx 변환·검증, 스타일 카탈로그, 표 기하 스냅샷, 에이전트 스킬 동기화
cp .env.example .env.local               # Windows PowerShell: Copy-Item .env.example .env.local
pnpm dev                                 # http://localhost:3000
```
`lib/agents/*` 를 수정한 뒤에는 dev 서버를 재시작한다(실행 관리자가 globalThis 에 상주).
참고 `.hwp` 원본 2종은 `templates/notice/reference.hwp`, `templates/plan/reference.hwp` 에 둔다(git 제외).

### Windows 참고
- Claude Code CLI는 네이티브 설치(`%USERPROFILE%\.local\bin\claude.exe`)나 npm 전역 설치(`%APPDATA%\npm\claude.cmd`) 모두 찾는다. 다른 곳에 있으면 `CLAUDE_BIN`에 전체 경로를 적는다.
- 환경변수로 포트 등을 바꿀 때: PowerShell `$env:PORT=3117; pnpm dev`, cmd `set PORT=3117 && pnpm dev`.
- `scripts/hancom-check.sh`(한글에서 열림 확인)와 교육영상 제작 스크립트는 macOS 전용 개발 도구다. 생성된 HWPX는 Windows 한글에서 직접 열어 확인한다.
- 줄바꿈은 `.gitattributes`로 LF 고정이다(골든 비교가 바이트 단위).

## 구조
- `lib/docmodel` — DocModel(zod) · GEPA DSL 파서(스트리밍) · 직렬화
- `lib/hwpx` — 템플릿 보존 HWPX 작성기(`build.ts`), 스타일 레지스트리, 표/그림/문단 emitter, `@rhwp/core` 검증·렌더
- `lib/agents` — `claude -p` 서브프로세스 러너, stream-json 파서, 실행 관리자, SSE
- `lib/stages` — 단계 문서 저장/버전/내보내기, 실행↔문서 파이프라인 연결
- `agent/.claude` — 에이전트 페르소나(`agents/*.md`)와 디자인 시스템 스킬(`skills/*`)
- `templates/<family>` — 큐레이션된 HWPX 패키지, 스타일 맵, 기하 스냅샷, 골든 DSL
- `docs/design-system` — 참고 문서 분석 보고서 · `docs/adr` — 결정 기록

## 사용
1. `새 프로젝트`에서 주제·지역·주관기관·담당 연락처를 입력한다.
2. 파이프라인 화면에서 **조사 → 사업계획서 → 공고문 → 보도자료** 순으로 실행한다. 각 단계 화면은 왼쪽 에이전트 활동, 가운데 한글식 편집기(실시간 타이핑), 오른쪽 실제 HWPX 렌더로 구성된다.
3. 결과가 마음에 들지 않으면 `이어서 수정 요청`으로 같은 세션에 지시를 추가하거나, 편집기에서 직접 고친다(800ms 후 자동 저장·재렌더).
4. 편집기 아래 `검토`를 누르면 검토관 에이전트가 골격·글머리·고정문구·수치·공문 표기·미확정 자리표시자(00)를 점검해 점수와 이슈 목록(JSON)을 낸다. `자동 수정 (N건)`은 오류·주의 항목을 작성자 세션에 전달해 문서를 고친다(`--resume`).
5. `HWPX 다운로드` / `PDF 다운로드`(보도자료는 .md/.txt 추가)로 내보낸다. 버전 기록에서 이전 판으로 되돌릴 수 있다.

실시간 타이핑은 에이전트가 `Write` 도구로 `<stage>/draft.dsl.md` 를 저장하는 스트림(tool input delta)을 그대로 디코딩해 보여준다(`lib/agents/writeStream.ts`). 문서를 답변에 다시 출력하지 않으므로 작성 단계가 그만큼 빨라진다. 에이전트가 같은 실행에서 파일을 다시 쓰면 화면은 그대로 두고("다시 쓰는 중" 표시) 새 판이 완성되는 순간 한 번에 바꾼다.

고정 문구는 `{{boilerplate:이름}}` 매크로로만 들어간다(6-1 공고문 원문 그대로, `기업게좌` 오타 포함). 신청 주체가 시군·기관인 공모는 `대상=기관` 변형(참여제한대상·예산상황·기업부담금·지급방법·기타유의사항)을 쓴다 — 참조 문서가 없어 같은 문체로 정한 문안이며 `lib/docmodel/boilerplate/notice.ts`에 있다.

HWPX 세부: 표의 합계 행 숫자는 열 합계 수식 필드(`=SUM(?2:?6)`, 참조 문서와 동일)로, 정량평가표 셀의 배점 구간 줄(`구분: 30%이상 30 / …`)은 참조 공고문의 2×N 중첩 배점표로 변환된다. `Preview/PrvImage.png`에는 1쪽을 200px로 래스터화한 실제 미리보기가 들어간다(한글 파일 탐색기 미리보기용).

사업계획서 front-matter에 `house: bumpis` 를 넣으면 범정부오피스(행안부 표준 보고서) 서식으로 생성된다(`docs/design-system/bumpis.md`).

### 조사 자료원 — 내부 위키 · 공공데이터 API · 웹
조사(연구)와 사업계획서 단계는 자료를 **위키 → 공공데이터 API → 웹검색** 순으로 찾는다.
- **내부 위키**: `.env`의 `GEPA_WIKI_DIR`에 진흥원 위키(마크다운) 경로를 주면 실행 시 `.md` 파일을 `DATA_DIR/wiki/`에 읽기 전용(0444)으로 복사해 `--add-dir`로 붙인다(원본은 마운트하지 않음 — `--add-dir`는 쓰기 권한도 주기 때문). 이전 연도 계획안·예산·실적이 그대로 근거가 된다.
- **공공데이터 API**: `agent/mcp/server.ts`(MCP, stdio)를 `claude -p --mcp-config`로 붙인다. 도구: `customs_trade`(관세청 시도/시군구·HS6/국가/품목×국가), `store_stats`·`store_upjong_codes`(소진공 점포 수), `kosis_search`→`kosis_table`, `law_search`→`law_text`(법제처 법령·조례), `bizinfo_search`(기업마당 지원사업), `policy_news_search`(정책브리핑), `data_sources_status`. 키는 `.env`(`DATA_GO_KR_KEY`·`DATA_GO_KR_SERVICES`·`KOSIS_KEY`·`LAW_OC`·`BIZINFO_KEY`)에만 두고 설정 JSON에는 넣지 않는다. 모든 응답에 `source{기관, 서비스, url(키 가림), 기준시점}`이 붙어 `sources.json`에 그대로 들어간다. `pnpm data:status`(설정 확인), `pnpm data:smoke`(실호출). 신청할 서비스와 선정 근거: `docs/research-data-sources.md`.
- 자식 CLI는 `--setting-sources project`로 띄워 사용자 전역 에이전트·플러그인·훅이 문서 실행에 섞이지 않는다(단, `~/.claude/CLAUDE.md` 메모리는 CLI가 여전히 읽는다).

### 모델
단계별 기본 모델은 하이브리드다(`lib/agents/limits.ts` `STAGE_MODELS`): 판단이 많은 **조사(종합)·사업계획서 = opus**, 골격을 채우는 **공고문·보도자료·검토 = sonnet**. 조사에서 페이지를 대량으로 읽는 `researcher` 하위 에이전트도 sonnet이다(`agent/.claude/agents/researcher.md`). 구독은 사용량 한도로 소진되며 opus가 sonnet보다 한도를 훨씬 빨리 쓰므로, 품질 차이가 작은 단계부터 sonnet을 쓴다. 실행 버튼 옆의 선택 상자에서 실행 단위로 바꿀 수 있고(`실행 기록`의 모델 표시와 활동 로그의 `세션 시작 · 모델 …`로 어느 모델이 썼는지 남는다), `.env.local`의 `GEPA_MODEL_<STAGE>`(예: `GEPA_MODEL_NOTICE=opus`) 또는 `GEPA_MODEL`로 기본값을 바꿀 수 있다. 값은 `claude --model`에 그대로 전달된다(별칭 또는 모델 id).

## 검증
```bash
pnpm test                # 파서·작성기·러너·파이프라인 테스트 (vitest)
pnpm typecheck && pnpm lint
pnpm golden              # 6-1 공고문 골든 재현 + rhwp verify/render-diff
pnpm test:e2e            # Playwright: 재생 실행 → 실시간 타이핑 → 저장 → HWPX 내보내기·렌더 → 편집·자동저장·다운로드, 다시 쓰기
pnpm agent:smoke         # claude -p 서브프로세스 스모크 (구독 로그인 확인)
```
e2e는 `claude` 없이 돈다: 합성 stream-json 픽스처(`lib/agents/replayFixtures.ts`)를 개발 전용 `POST /api/dev/replay`(`GEPA_DEV_REPLAY=1`일 때만)로 재생하고, 별도 포트(3119)·별도 데이터 폴더(`.e2e-data`)·별도 빌드 폴더(`.next-e2e`)의 개발 서버를 자동으로 띄운다.
실제 한글에서의 열림 확인: `open -a "Hancom Office HWP" data/projects/<id>/<stage>/out.hwpx`
`@rhwp/core` 검증은 필요조건일 뿐이다(rhwp는 관대하고 한글은 엄격하다 — ADR 0004). 새 합성 블록을 추가하면 한글에서 한 번은 열어 본다.
어느 블록이 문제인지 좁힐 때는 `pnpm exec tsx scripts/build-subset.ts <doc.json> <out.hwpx> kinds:para,table` 처럼 블록 부분집합으로 빌드해 연다.

2026-09-15 실측: 「2026년 안동시 수출기업 역량강화 지원사업」 주제로 4단계를 실제 CLI로 완주 —
조사 30개 출처, 사업계획서 13쪽, 공고문 7쪽, 보도자료 2쪽, 모든 HWPX 검증 통과(contentLoss 0).
같은 날 사업계획서·보도자료 산출물을 한글에서 열어 확인(사업계획서는 결재란 조각의 secPr 중복으로 처음엔 열리지 않았고, ADR 0004로 수정).
검토관 실행: 공고문 점수 72 → 지적 9건(고정문구 5·자리표시자 등 4) → `자동 수정` 후 매크로·확정 날짜 반영.

## 문제 해결
- 개발 서버가 `panicked at crates/next-code-frame/src/highlight.rs … is not a char boundary; it is inside '…'` 로 죽으면: 한글이 든 파일에 **컴파일 오류**가 있는데 Turbopack(Next 16.3.5)이 그 코드 프레임을 그리다 죽은 것이다. `pnpm exec next dev --webpack` 으로 띄우면 실제 오류 위치가 보인다(2026-09-15: 프롬프트 템플릿 리터럴 안의 백틱이 원인이었음). 서버가 죽으면 실행 중이던 `claude -p` 자식은 고아가 되어 파일은 계속 쓰지만 실행 기록은 `failed`로 남는다.
- 개발 서버를 재시작하면 진행 중이던 실행은 `server restarted while the run was active` 로 실패 처리된다. 완료된 산출물(`draft.dsl.md`, `notes.md`)은 디스크에 남아 있으므로 `이어서 수정 요청`으로 재개하거나 다시 실행한다.
- 구독(`claude` 로그인)의 세션 한도에 걸리면 실행이 `You've hit your session limit · resets …` 오류로 끝난다. 한도가 풀린 뒤 `이어서 수정 요청`(같은 세션 재개) 또는 다시 실행하면 된다. 조사 단계는 13턴·20분 안팎, 사업계획서 18분, 공고문 11분, 보도자료 7분, 검토 8분이 실측치다.
