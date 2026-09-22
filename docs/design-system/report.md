# GEPA 주요업무보고 DESIGN SYSTEM

Source: `templates/report/reference.hwpx` (`curate-template.ts report --from-hwpx` 로 큐레이션).
`templates/report/catalog.json` · `templates/report/style-map.json` · `templates/report/geometry/`.

Units: 1 pt = 100 HWPUNIT, 1 mm = 283.465 HWPUNIT (notice.md/press.md와 동일).

**이 문서는 측정 기록이다.** 값마다 어디서 읽었는지를 함께 적는다. 근거를 대지 못하는 항목은
그렇다고 적었다 — 이 브랜치에서 담당자가 한글에서 찾아낸 결함 일곱 건 가운데 여럿이, 코드가
하지 않는 일을 우리 문서가 한다고 적어 둔 데서 나왔다.

## 0. 담당자가 한글에서 확인하며 정한 서식 (이 절이 아래 실측보다 우선한다)

이 문서를 실제로 쓰는 진흥원 담당자가 생성물을 한글에서 열어 보고 정한 것들이다. **참고본과
다른 항목이 있고, 그럴 때는 담당자 쪽이 맞다** — 결재에 올라가는 것은 우리가 옮겨 적은 사본이
아니라 이 문서다.

### 글머리 사다리

| DSL 기호 | 무엇 | 앞 공백 | 문단 위 | 문단 아래 |
|---|---|---|---|---|
| `□` | 소제목 — **글자가 아니라 초록 그러데이션 도형 칩**이 나간다 | 0 | 10pt | 0 |
| `●` | 본문 1단계. 내보낼 때 심볼 글꼴의 `U+F06D` 로 바뀐다 | 1 | 5pt | 0 |
| `-` | 본문 2단계 | 3 | 3pt | 0 |
| `·` | 본문 3단계 | 3 | (측정하지 않음) | (측정하지 않음) |

- 줄간격은 셋 다 160%. **참고본은 문단 위 0 / 아래 1.5pt 인데 담당자가 위로 벌리는 쪽으로
  바꿨다.** 참고본 값은 `paraPr 147`(`●`)의 `hp:case` 에서 직접 읽었다: `prev=0, next=150`.
- 구현은 `lib/hwpx/writers/report.ts` 의 `PARA_SPACING` 이다. 참고본의 문단모양 146·147·150 을
  **고치지 않고**, 같은 모양에서 위·아래만 바꾼 문단모양을 새로 등록해 쓴다(큐레이션을 다시
  뜨면 참고본 수정은 날아간다 — 참고본 패키지는 "참고본이 무엇이었나"의 기록이어야 한다).
- **`ㅇ` 을 쓰지 않는다.** 참고본은 일반현황 목록에 `ㅇ` 을 쓰지만 담당자가 `●` 로 통일하라고
  했다. `ㅇ` 자체는 사다리(`DOC_FAMILIES.report.indent`)에 남아 있다 — 손으로 쓴 DSL 을 깨지
  않기 위해서다. **에이전트에게는 `●` 만 가르친다**(`agent/.claude/skills/gepa-report-design/`).
- `·` 는 사다리 표에는 있지만(들여쓰기 3칸) 문단 간격을 측정한 적이 없고, 에이전트에게도
  가르치지 않는다. 사다리는 `□ → ● → -` 에서 멈춘다.

### 요약박스 (```` ```box ````)

**절이 요약문으로 시작하면 박스, 목록이나 표로 시작하면 박스 없음.** 장으로 나뉘지 않는다.

| 절 | 칩 뒤 | 박스 |
|---|---|---|
| Ⅰ-1 설립목적 | 요약문 | **있음** |
| Ⅰ-2 연혁 | `●` 목록 | 없음 |
| Ⅰ-3 조직 및 인원 | 목록 + 조직도 | 없음 |
| Ⅰ-4 예산 | 예산표 | 없음 |
| Ⅰ-5 주요업무 | 부서별 표 | 없음 |
| Ⅱ·Ⅲ 사업 절 | 요약문 | 있음 |

**자동으로 달지 않는다** — 자동이면 연혁의 `● 1997년` 목록 첫 줄이 박스에 갇힌다. 작성자가
```` ```box ```` 를 쓴 자리에만 나간다.

### 표지

**제목 말고 글자를 한 줄도 넣지 않는다.** `보고일`·`부서` 를 표지에 쓰지 않는다(메타에는
남는다 — 아래 §5). 참고본도 그렇다. 커밋 `1ac6f3e` 가 그 두 줄을 걷어 냈다.

### 목차

쪽번호는 **자리표시자 `―`(U+2015)** 다(`report.ts` 의 `TOC_PLACEHOLDER`). **숫자를 지어내지
않는다** — 작성기는 쪽을 흘려 보지 않으므로 진짜 쪽번호를 알 수 없고, `0` 이나 빈칸은 진짜
쪽번호처럼 보인다. **담당자가 한글에서 손으로 채워야 한다.** 이 한 줄은 완료 보고와 사용자
안내에 반드시 들어가야 한다.

## 1. 문서 골격

표지 → (쪽 나눔) → 보고순서(목차 상자) → (쪽 나눔) → 간지 `Ⅰ` → 빈 쪽 → 절 칩 `1` →
요약박스 → 사다리 → … 간지는 `#`, 절 칩은 `##` 로 DSL 이 자리를 정한다
(`DOC_FAMILIES.report.headingStyle = "chapterChip"`). 번호 `Ⅰ·Ⅱ·Ⅲ` 와 `1·2·3` 은
expander 가 자동으로 매긴다(`expanders/report.ts`, `numeralStyle: "roman"`) — 작성자가 직접
적으면 그 번호부터 이어진다.

**간지 Ⅰ·Ⅱ·Ⅲ 은 본문 중간에 되풀이된다.** 공문서의 두문·결문처럼 고정된 자리가 아니라서
작성기가 혼자 놓을 수 없고, 그래서 이 family 만 `#`/`##` 문법을 연다.

**간지 `#` 줄 앞에는 쪽 나눔이 있어야 한다.** 작성기는 `chapterBand` 에 쪽 나눔을 자동으로
걸지 않고 DSL 의 `<pagebreak>` 만 본다. `tests/fixtures/report-sample.dsl.md` 를 빌드해
`section0.xml` 의 `pageBreak="1"` 을 세어 확인했다: 앞에 `<pagebreak>` 가 있는 Ⅰ 간지는 쪽
머리에서 시작하고, 없는 Ⅱ 간지는 앞 내용에 이어 붙어 쪽 한가운데 찍힌다. 간지 뒷면 빈 쪽은
`<pagebreak>` · 빈 줄 · `<pagebreak>` 석 줄로 만든다 — `emitBlank` 도 `ctx.para` 를 거치므로
대기 중인 쪽 나눔을 먹는다(`writers/context.ts:79`).

목차는 합성되지 않는다. 작성자가 ```` ```toc ```` 를 쓰지 않으면 보고순서 쪽이 통째로 빠진다
(`expanders/report.ts` 의 `reportPrelude()` 는 빈 배열을 돌려준다 — 실측).

## 2. style-map 역할별 근거 (`templates/report/style-map.json`)

| 역할 | paraPr | charPr | 근거 |
|---|---|---|---|
| `coverTitle` | 45 | 47 | `geometry/cover.xml` 의 도형 **안** 문단이 쓰는 값과 같다(report.ts 주석; 재측정 안 함). 그래서 조각이 없을 때의 대비 문단도 같은 모양으로 나간다 |
| `coverBox` | 2 | 47 | 표지 제목 도형을 담는 앵커 문단 |
| `tocHeading` | 15 | 48 | `보 고 순 서` 제목 줄. **맺어 두었지만 작성기가 아직 쓰지 않는다** — 지금은 목차 상자(`t02`)만 나간다(§7) |
| `tocLine` | 108 | 130 | `paraPr 108` 에 `tabPrIDRef="1"` 이 딸려 오고, `tabPr 1` 이 `<hh:tabItem pos="43500" type="RIGHT" leader="CIRCLE"/>` 다(실측). **이 매핑을 놓치면 목차 점선이 사라진다** |
| `chapterBand` | 53 | 127 | 간지 `Ⅰ. 일 반 현 황` 줄 |
| `chipLabel` / `chipTitle` | 57 / 58 | 103 / 57 | 절 칩 1×2 표. 칸 너비 `[3719, 43905]`·높이 2980 은 `geometry/t31`(=`t34`·`t36`) 실측, 색은 참고본 borderFill 53(번호)·52(제목)·4(테두리) — 둘 다 report.ts 주석에서 옮겼다(재측정 안 함) |
| `summary` | 70 | 153 | 요약박스 안 문단. 상자는 `geometry/t32` 계열, 칸 색 `#F2F2F2` + 점선 네 변(report.ts 주석; 재측정 안 함) |
| `subHeading` | 146 | 142 | `hp:case` 실측: `intent=-4040, prev=0, next=150, lineSpacing=160` |
| `listItem` | 86 | 102 | 참고본 일반현황의 평평한 목록(`ㅇ 1997년 …`, `ㅇ 조  직: …`) 열한 번이 모두 이 쓰임(report.ts 주석; 재측정 안 함) |
| `bullet1` | 147 | 10 | `hp:case` 실측: `intent=-2713, prev=0, next=150, lineSpacing=160` |
| `bullet1Mark` | 147 | 163 | `●` 기호와 뒤 공백만 담는 run. 참고본 run 짜임(문단 117·120·123·128·136): `[143 " "] [163 "U+F06D + 공백"] [10 본문]` — run 짜임은 report.ts 주석에서 옮겼고(재측정 안 함), 기호 14pt·본문 15pt 는 `header.xml` 의 charPr 163·10 에서 직접 읽었다 |
| `bullet2` | 150 | 116 | `hp:case` 실측: `intent=-3264, prev=0, next=150, lineSpacing=160` |
| `tableAnchor` / `blank` | 68 | 97 | 표·빈 줄 앵커 문단 |

style-map 에 **일부러 넣지 않은** 역할이 둘 있다: `note`(`※`)와 `coverSpacer`. 참고본에 깨끗한
짝이 없어서 `report.ts` 의 `FALLBACK` 상수로 두었다 — 어림짐작한 paraPr 를 style-map 에 적어
두면 나중에 그것이 실측인지 짐작인지 아무도 알 수 없다.

`□` 는 참고본에 글자 표지가 아예 없다. 소제목 줄의 표지 노릇은 인라인 도형 칩
(`geometry/chip.xml`, 흰색→`#4E9484` 그러데이션 `hp:rect` 두 장)이 한다. DSL 쪽에 기호 하나를
골라 줘야 해서 `□` 를 맺었다(`ㅇ` 는 `listItem` 이 먼저 쓰고, `●`·`-`·`·` 는 아래 칸이 쓴다).
`□` 로 쓴 줄은 **기호를 글자로 내지 않는다.**

## 3. 다음 사람이 똑같이 걸릴 함정 셋

### 3.1 `●` 는 `U+F06D` 다

참고본 `section0.xml` 에 `U+25CF`(진짜 `●`)는 **0개**, `U+F06D` 가 **63개**다. 재현:

```bash
python3 -c 'import zipfile,re,collections;
s=zipfile.ZipFile("templates/report/reference.hwpx").read("Contents/section0.xml").decode("utf-8");
print(s.count("\uf06d"), s.count("●"));
c=collections.Counter(pp for pp,b in re.findall(r"<hp:p\b[^>]*paraPrIDRef=\"(\d+)\"[^>]*>(.*?)</hp:p>",s,re.S) if "\uf06d" in b);
print(len(c), c.most_common(3))'
# → 63 0
# → 28 [('79', 8), ('147', 6), ('117', 5)]
```

63개가 paraPr **28개**에 흩어져 있고 `79` 가 8개, `147` 이 6개로 가장 많다. 심볼 글꼴은
**한양신명조**다(`charPr 163` 의 `fontRef symbol="14"` → `hh:fontfaces lang="SYMBOL"` 의 15번째).

`bin/rhwp export-text` 가 이것을 `●` 로 옮겨 주기 때문에 **추출 글만 보면 `●` 로 보인다.**
그래서 `●` 로 grep 하면 참고본 패키지에서는 아무것도 나오지 않는다. 우리가 지어낸 기호가
아니라 사용자 정의 영역(PUA)에 담긴 글머리의 전사다.

DSL 은 사람이 읽고 grep 할 수 있는 `●` 를 쓰고(작성자가 `export-text` 에서 보는 것도 그
글자다) 작성기가 나가는 길에 `U+F06D` 로 옮긴다(`report.ts` 의 `BULLET1_PUA`).

### 3.2 터미널은 `U+F06D` 를 빈칸으로 그린다

`<hp:t> </hp:t>` 가 공백이 아닐 수 있다. XML 조각을 읽을 때는 눈으로 세지 말고 코드포인트를
찍어라: `[hex(ord(c)) for c in t]`. **이 저장소가 이 함정에 세 번 걸렸다**(구현자 둘,
컨트롤러 하나).

### 3.3 `ParaSpec` 의 여백과 `paraPrInfo` 의 값은 단위가 다르다

`ParaSpec`(`lib/hwpx/registry.ts`)은 한글이 보여 주는 단위(100 = 1pt)이고, `paraPrInfo` 는
`header.xml` 의 `hp:default` 가지를 읽는데 거기엔 **두 배**로 적혀 있다.
`registry.ts:206` 이 쓸 때 2배, `registry.ts:254` 가 `hp:case` 에 0.5배를 건다. 실측 확인
(`paraPr 147`):

| 가지 | intent | next |
|---|---|---|
| `hp:case` (한글 UI 단위) | -2713 | 150 |
| `hp:default` | **-5426** | **300** |

`paraPrInfo` 가 돌려주는 -5426 을 그대로 `ParaSpec.hanging` 에 되먹이면 **내어쓰기가 두 배**가
되어 둘째 줄이 훨씬 안쪽에서 시작한다. 실제로 한 번 그렇게 나왔다. `report.ts` 의
`withSpacing()` 이 `half()` 로 나누는 것이 그 자리다.

같은 미끄러짐이 `report.ts` 의 `FALLBACK` 상수에 반대 방향으로 남아 있다: `bullet1.hanging`
이 1357(= 2713 ÷ 2)이라 참고본 `hp:case` 의 절반이다. style-map 이 `bullet1` 을 맺고 있어 실제
출력에는 쓰이지 않지만, 역할이 빠졌을 때만 드러나는 종류의 어긋남이다.

## 4. 한글 승인은 rhwp·resvg 로 대신할 수 없다 (ADR 0004 의 실제 사례)

이 브랜치에서 생성물이 **한글을 죽였다**(`EXC_BAD_ACCESS`, 널 역참조, `_doOpenFile:` 바로
아래). 그때 우리 테스트 **459개가 전부 초록**이었고 rhwp `verify`·`validate` 와 resvg 렌더도
모두 통과했다. 끊긴 파트를 아무도 보지 않았기 때문이다.

원인: `section0.xml` 의 `secPr` 이 `<hp:masterPage idRef="masterpage0"/>` 를 가리키고
`content.hpf` 도 그것을 선언하는데, `Contents/masterpage0.xml` 이 패키지에 없었다. `build.ts`
가 파트를 손으로 나열하고 `BinData/` 만 반복 복사했다. 업무보고서 전까지는 어느 family 의
참고본에도 바탕쪽이 없어서 이 경로가 필요한 적이 없었다 — 그래서 이 수정으로 네 family 의
출력은 한 바이트도 바뀌지 않았다. 커밋 `8d531c0`.

그 뒤로 테스트는 판독기를 믿지 않고 **zip 목록과 참조를 직접 대조한다.**

담당자가 한글에서 열어 보고 찾아 준 결함은 이 건을 포함해 일곱 건이다. 생성물은 **반드시
한글에서 연다.**

## 5. front-matter 중 작성기가 실제로 읽는 것

`ReportMetaSchema`(`lib/docmodel/schema.ts`)는 여섯 칸이고 모두 `.default()` 라 빈 객체도
파싱된다. 그 가운데 HWPX 에 도달하는 것은 하나뿐이다(실측 — 나머지는 `lib/`·`components/`
어디에서도 읽는 곳이 없다):

| 칸 | 작성기가 읽는가 | 쓰임 |
|---|---|---|
| `제목` | **읽는다** | 표지 제목 도형의 글, `exportBaseName` = `제목 + "_주요업무보고"` |
| `보고일` · `보고대상` · `부서` · `대상기간` | 읽지 않는다 | 편집기 MetaSheet 에 남는 문서의 기록 |
| `목차표시` | 읽지 않는다 | 목차는 ```` ```toc ```` 를 쓸 때만 나간다 |

그래도 채워 두는 편이 낫지만, **비었다고 해서 날짜나 받는 사람을 지어내서는 안 된다.**

## 6. 이 가족이 다른 넷과 갈라지는 곳

- **문단 모양을 합성하지 않고 참고본의 id 를 그대로 쓴다.** 참고본의 본문 문단은 왼쪽 여백 0 에
  음수 `intent`(내어쓰기)만 걸려 있고 단계 들여쓰기는 **글자로 넣은 반각 공백**이다. `emitPara`
  처럼 align·lineSpacing·hanging 으로 새 paraPr 를 합성하면 참고본이 손으로 맞춰 둔 내어쓰기
  폭(단계마다 다르다)이 사라진다.
- `requiresClosingMark: false` — 공문의 `끝.` 은 시행규칙 제4조제5항의 법정 요구사항이고
  업무보고에는 없다.
- `<조직도>`(영문 `<orgchart>`)는 이 family 전용이다. 글(원장·본부·실·팀·지소)은 참고본 조각
  `templates/report/geometry/t09.xml` 에 굳어 있고 DSL 은 **자리만** 정한다 — 조직이 개편되면
  조각을 다시 뜬다.
- 쪽번호는 작성기가 내지 않는다. `templates/report/pkg` 의 첫 문단이 이미
  `<hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/>` 를 들고 있고 `build.ts` 가
  구역에 pageNum 이 없을 때 그것을 첫 문단에 꽂는다(plan·press·official 과 같다).

## 7. 아직 하지 않은 것

- 보고순서 쪽의 `보 고 순 서` 제목과 밑줄표(`t01`) — 지금은 상자 `t02` 만 나간다.
- `report` kind·UI, 골든 테스트, 표지 쪽번호 숨김(`build.ts`).
- `·`(3단계)의 문단 간격 측정.
