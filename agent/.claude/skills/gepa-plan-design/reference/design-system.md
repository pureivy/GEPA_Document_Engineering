# 사업계획서 HWP Design System — Extraction Report

Source: `/Users/sangbumnam/Desktop/공고문, 보고서 등 작성/` (5 사업계획(안) files)
Tooling: pyhwp (`hwp5proc xml`), parsed with `scratchpad/parse.py`; digests in `scratchpad/r1..r5.txt`.

**Reading the per-file outlines in §2:** the digest script concatenates table-cell text into the
paragraph that anchors the table. Any outline line that is a long unspaced run
(`등록번호민생경제지원팀-1751담  당팀장…`, `연도별성과구분예산(천원)…`) is table content, and its
`lead` count and `cs=` id do not describe a real paragraph style. The `□ / ㅇ / - / · / ※` rows are
genuine paragraphs with their own charshapes (verified: 118–494 such paragraphs per file), so the
level spec in §3.2 is unaffected.

## 0. Unit conversions used (verified)

| Field | Raw unit | To pt | To mm |
|---|---|---|---|
| `CharShape/@basesize` | 1/100 pt | `/100` | — |
| `ParaShape/@doubled-margin-*` | 2 × HWPUNIT | `/200` | — |
| `PageDef/*-offset`, table/cell `width`,`height` | HWPUNIT (1/7200 in) | `/100` | `/7200*25.4` |
| `TableCell/@padding-*` | HWPUNIT | `/100` | — |

Verification: `hwp5html` CSS for file 2 renders charshape 6 as 함초롬바탕 10pt (basesize 1000) and parashape 1 as `margin-left:15pt` (doubled-margin-left 3000). Font-index resolution uses per-language FaceName sublists (ko/en/cn/jp/other/symbol/user counts from `IdMappings`), confirmed against the same CSS.

**Important layout finding:** `ParaShape/@indent` (first-line indent) holds raw values in the range −23696 … +1040 across the five files. pyhwp types it as a plain signed HWPUNIT (`/100` → −237pt), while `hwp5html` renders it with the doubled divisor (`/200` → −118pt); either way the number is implausible, and it is **not applied** — every `LineSeg` in every file has `x="0"` and full text width (48188 HWPUNIT = 481.9pt = 170mm). Indentation of `□ / ㅇ / - / ·` levels is produced **entirely by leading half-width spaces in the text**, with `doubled-margin-left = 0` on essentially all body paragraphs. Generators must reproduce indentation with leading spaces, not with indent attributes.

## 1. Page setup — identical in all five files

```
paper      : 59528 × 84186 HWPUNIT = 210.0 × 297.0 mm (A4 portrait)
left/right : 5669 HWPUNIT = 20.0 mm each
top        : 4251 HWPUNIT = 15.0 mm
bottom     : 4252 HWPUNIT = 15.0 mm
header     : 2834 HWPUNIT = 10.0 mm
footer     : 2834 HWPUNIT = 10.0 mm
gutter     : 0 (bookbinding = left)
text width : 170 mm = 481.9 pt  (all full-width tables are 476–482 pt)
columns    : 1, columnspacing 1134 HWPUNIT (8 mm)
sections   : exactly 1 SectionDef per file — no landscape or re-margined 붙임 section
page number: PageNumberPosition position="bottom_center", dash="-"  (i.e. "- 1 -")
header/footer text: none in any file
```

## 2. Per-file analysis

### File 1 — `4. 2026 「지역경제 혁신 박람회」 사업계획(안).hwp`

Numbering style: **Arabic `1. 2. 3.`** chapters (no Roman band). This is the oldest file (created 2021) and the only one using 아라비아 chapter numbers.

Outline:
```
[결재 블록]                            1×2 logo table + 12×11 approval grid
2026 지역경제 혁신 박람회 사업계획(안)   cover title, HY헤드라인M 22pt w95%
◇ 요약 2줄 박스                        1×1 table, HY중고딕 14pt sp-3% w95%
1. 사업개요            HY헤드라인M 16pt, sp_before 10pt, ls 180%
   □ 사업기간 / □ 사업예산 / □ 사업내용
2. 행사개요
   □ 행사기간 / □ 행사장소 / □ 행사주최 / □ 참가대상 / □ 주요내용
      ○ … (6 items)
3. 세부추진계획
   □ 경상북도 통합 홍보관 운영 → ○ 전시규모: 20개 부스  [표: 배치도]
   □ 전시콘텐츠 구성(예시) → ○ 도 및 시·군 전시테마 및 구성  [표 17×3]
4. 추진일정(안)                          [표 7×5]
5. 소요예산
   □ 소요예산: 금192,000,000원(…)         [표 7×5]
   ※ ×3 (변경가능 / 예산관리 / 정산)
   □ 예산과목 → ○ (정책사업)…
   □ 기관별 예산배정 내역                 [표 17×6]
```

Level styles:

| Level | Char shape | Para shape |
|---|---|---|
| 표지 제목 | HY헤드라인M 22pt, width 95% | align left/both, ls 100% |
| 요약 ◇ | HY중고딕 14pt, spacing −3%, width 95% | left, ls 160% |
| 1. 장 | HY헤드라인M 16pt | both, sp_before 10pt, ls 180% (later 160/120%) |
| □ | 휴먼명조 15pt **bold** | both, lead 1 space, sp_before 5pt, ls 180% |
| ○ | 휴먼명조 15pt regular | both, lead 2 spaces, sp_before 0, ls 180% |
| ※ | 휴먼명조 15pt regular | both, lead 1 space, sp_before 3pt, ls 100% |
| 표 캡션(우측) | 한양중고딕 13pt bold sp−10% w95% | align right |
| 표 헤더 | HY중고딕 12pt bold | center, fill `#d9d9d9` |
| 표 본문 | HY중고딕 12pt (숫자표 10pt/9pt) sp−10% w90% | |

Tables:
- `#6` 17r×3c 전시콘텐츠: 콘텐츠(부스) 56.9pt | 컨텐츠 구성 및 운영 368.0pt | 비고 39.8pt
- `#7` 7r×5c 추진일정: 일자(3 merged cols: 시작 69.0 / `~` 26.5 / 종료 69.0) | 주요일정 252.1 | 비고 56.9
- `#8` 7r×5c 소요예산: 항목 47.1 | 세부항목 112.2 | 산출내역 184.8 | 금액 87.2 | 비고 44.8; last row 합계 spans 3 cols, fill `#d9d9d9`
- `#9` 17r×6c 기관별 배정: 구분 92.3 | 총 사업비 78.9 | 사업비(88.5%) 78.9 | 운영비(2.5%) 78.9 | 수수료(9%) 78.9 | 비고 61.2; 계 row fill `#f2f2f2`

Borders: header/body `0.12mm solid #808080`, outer/section rules `0.4mm` or `0.5mm solid #808080`; some tables use `double 0.5mm #000000` under the header row. Fills: header `#d9d9d9`, subtotal `#f2f2f2`, accent `#b6dde8`.

Fonts present (ko): 굴림, 돋움, 돋움체, 맑은 고딕, 바탕체, 양재난초체M, 한컴돋움, 함초롬돋움, 함초롬바탕, 휴먼고딕, **휴먼명조**, HY신명조, **HY중고딕**, **HY헤드라인M**, 신명 태명조, 태 가는 헤드라인T, 한양중고딕.

### File 2 — `5. 「2026 영양군 공공배달앱」 사업계획(안).hwp`

Numbering style: **Roman band `Ⅰ Ⅱ Ⅲ Ⅳ Ⅴ`**, sub-levels `ㅇ` then `-`.

Outline:
```
[결재 블록]
「2026 영양군 공공배달앱」 사업계획(안)   cover, HY울릉도B 23pt sp33% #000094
• 사업기간/사업예산/사업대상/사업내용     cover summary, 맑은 고딕 13pt w98%, centered
[속표지] 「…」사업계획(안)               HY헤드라인M 24pt sp−6% #3c32cd
[목적 박스] 1×1, fill #dfe6f7, 맑은 고딕 15pt sp−4%
Ⅰ 추진배경 및 목적
   ㅇ (추진배경) …
   ㅇ (추진목적) → - ×2
   ㅇ 추진실적                       [표 4×8 연도별 성과]
Ⅱ 사업개요
   ㅇ (사업기간)/(사 업 비)/(사업대상)/(사업내용)
Ⅲ 추진계획
   ㅇ 운영방법: 민관협력형 → - (앱 운영사) / - (영 양 군)
   ㅇ 운영체계도                     [도식 표 8×8]
                                     [표 4×2 구분/주요기능 및 역할]
                                     [표 2×7 프로세스 흐름]
   ㅇ 운영특징 → - ×2
   ㅇ 추진일정                       [표 4×2 시기/내용]
Ⅳ 소요예산(안)
   (단위 : 천원) 우측정렬 캡션         [표 7×4 구분/금액/산출내역]
   ㅇ 직접비 집행계획(안)              [표 5×5 시기/이벤트명/소요예산/산출내역/비고]
   ※ 주석
Ⅴ 기대효과
   ㅇ ×2, 마지막 "…  끝."
```

Level styles:

| Level | Char shape | Para shape |
|---|---|---|
| 장 번호 셀 | HY헤드라인M 20pt bold, `#ffffff` | 셀 fill `#003366` |
| 장 제목 셀 | HY헤드라인M 18pt | 셀 top+bottom border 0.5mm `#003366` |
| 목적 박스 | 맑은 고딕 15pt sp−4% | 1×1 표, fill `#dfe6f7`, pad 566 HWPUNIT |
| ㅇ | 휴먼명조 15pt | both, lead 1 space, sp_before 8pt, ls 160% → 140% |
| - | 휴먼명조 15pt | both, lead 2–3 spaces, sp_before 6pt |
| ※ | 한양중고딕 12pt bold | both, sp_before 8pt |
| (단위 : 천원) | 맑은 고딕 10pt | **align right**, sp_before 4pt |
| 표 헤더 | 맑은 고딕 12pt bold | fill `#d9d9d9` |
| 표 본문 | 맑은 고딕 10–12pt | |

Chapter band construction (the key reusable asset):
```
TableControl width 48110 HWPUNIT (481.1pt), inline, TableBody borderfill-id=25, cellspacing=0,
cell padding l/r/t/b = 140 HWPUNIT (1.4pt), 1 row × 3 cols
  cell0  w 29.9pt  borderfill fill #003366, all 4 borders solid 0.5mm #003366
         text: Ⅰ  HY헤드라인M 20pt bold color #ffffff, valign middle
  cell1  w  5.6pt  no fill, left border solid 0.5mm #003366   (spacer)
  cell2  w 445.6pt no fill, top + bottom borders solid 0.5mm #003366
         text: " 추진배경 및 목적"  HY헤드라인M 18pt #000000
```

Other fills: `#f0f0f0` (성과표 header), `#faf3db` / `#e0e0e0` (체계도 boxes), `#f2f2f2` (subtotal).

### File 3 — `5. 「한국어 및 경북학 문화교육사업」사업계획(안).hwp` (style outlier)

Numbering style: Roman band `Ⅰ … Ⅶ`, sub-levels `■` then `✔`, and circled `󰊱 󰊲 󰊳 󰊴` for 사업개요 items. 기대효과 uses `❍`.

Outline:
```
[결재 블록]
해외 우수인재 유치를 위한「한국어 및 경북학 문화교육사업」 사업계획(안)   한컴 소망 M 18/22/23pt sp−6…−12%
Ⅰ 추진배경 및 필요성
   ■ 경북도 내 외국인 유학생 증가 …   → ✔ ×2
   ■ 현지 인프라 고도화 …             → ✔ ×3
Ⅱ 사업개요
   󰊱 사업기간 / 󰊲 사 업 비 / 󰊳 사업내용 / 󰊴 주최·주관
Ⅲ 사업추진체계 및 추진일정
   [표 4×4 조직체계/조직 간 역할/비고]  [표 13×5 단계/추진 내용/추진일정]
Ⅳ 추진방향
   ■ 한국어·경북학 특화 어학 학습실 인프라 구축 → ✔ ×2
   ■ 맞춤형 교육 프로그램 및 교재 지원
   ■ 기관별 명확한 역할 분담 → ✔ ×3
   ※ 해외시설 설치 사례 [사진 2×2]
Ⅵ 기대효과      ❍ ×3
Ⅶ 소요예산      소요예산 / 예산과목  [표 9×5]  ※ 주석
```
(Chapter numbering skips Ⅴ — an authoring slip in the source.)

Level styles:

| Level | Char shape | Para shape |
|---|---|---|
| 표지 제목 | 한컴 소망 M 22–23pt bold sp−12% | ls 100% |
| 장 번호 셀 | 경기천년제목V Bold 22pt bold `#ffffff` | fill `#203a7b`, cell w 43.2pt |
| 장 제목 셀 | 경기천년제목V Bold 18pt | no fill, cell w 435.8pt |
| ■ | 함초롬돋움 14pt bold | both, sp_before 15pt, ls 180–200% |
| ✔ | 함초롬바탕 16pt (bold on some) sp−17% | both, lead 1–4 spaces, ls 200% |
| 󰊱 | 함초롬바탕 14pt bold | both, sp_before 6pt, ls 200% |
| ❍ | 함초롬바탕 14pt | both, lead 1 space, ls 200% |
| ※ | 한컴 소망 B 12pt | sp_before 10pt, sp_after 1pt |
| 표 헤더 | 함초롬돋움 13pt bold sp−5% / 함초롬바탕 13pt bold | fill `#e5e5e5` or `#dfe6f7` |

Fills: `#203a7b` (chapter number), `#e5e5e5`, `#dfeaf5`, `#fcf5e7`, `#dfe6f7`, `#f2f2f2`.
Budget table `#13` 9r×5c: 항목 49.2 | 구분(2 merged) 100.2 | 산출 내역 227.4 | 금액 98.4.

**This file does not share the house font stack.** It uses 함초롬바탕 / 함초롬돋움 / 한컴 소망 M·B / 경기천년제목V Bold instead of 휴먼명조 / HY헤드라인M. Treat it as a variant, not the norm.

### File 4 — `6. 2026년 상인·소상공인 AI 코칭 지원 사업계획(안).hwp`

Numbering style: Roman band `Ⅰ … Ⅴ` + numbered sub-bands `1 2 3 4`, then `□ → ◦ → -`. Has a 목차 page.

Outline:
```
[결재 블록]
2026년 상인·소상공인 AI 코칭 지원 사업계획(안)  HY헤드라인M 28pt sp−10% #000094
목   차   (textbox; Ⅰ.…1 / Ⅱ.…2 / Ⅲ.…3 with 1.~4. subitems / Ⅳ.…8 / Ⅴ.…9 / 참고자료)
Ⅰ 추진배경 및 목적
   □ 추진배경 → ◦ ×3   [실태 도표 ×5]
   □ 추진목적 → ◦ ×3
Ⅱ 사업개요 및 추진체계
   [1] 사업개요
       □ (사업기간)/(사 업 비)/(사업지역)/(수혜대상)/(지원내용)
   [2] 추진체계 및 역할
       □ 추진체계 및 역할 [표 6×3]
       □ 추진일정        [표 8×5 추진내용/8월/9월/10월/11월]
Ⅲ 세부 추진계획
   [1] AI 코칭 수행업체 모집 및 선정
       □ 운영계획 수립 / □ 수행업체 모집 / □ 수행업체 선정
   [2] 지원대상 모집 및 선정   □ 사업대상자
   [3] 세부 지원내용           □ 권역별 교육 / □ AI 코칭 지원 / □ 단골 AI 에이전트(API) 사용료 지원
   [4] 사업 및 성과관리        □ (성과관리) …
Ⅳ 소요예산     [표 14×4]
Ⅴ 기대효과
참고자료 / 붙임(개인정보 동의서 등, 나눔고딕 14pt bold)
```

Level styles:

| Level | Char shape | Para shape |
|---|---|---|
| 표지 제목 | HY헤드라인M 28pt sp−10% `#000094` | ls 100% |
| 장 번호/제목 | HY헤드라인M 20pt bold `#ffffff` / 18pt | 1×3 band table (same as File 2) |
| 절 번호 `1` | HY헤드라인M 15pt `#ffffff` | 1×2 band, cell0 w 25.7pt fill `#203a7b` |
| 절 제목 | HY헤드라인M 15pt | cell1 w 450.4pt fill `#d9d9d9`, cellspacing 198 |
| □ | 휴먼명조 15pt **bold** (일부 regular) | left/both, lead 0–1 space, sp_before 0 or 15pt, ls 180% |
| ◦ | 휴먼명조 15pt | both, lead 2 spaces, sp_before 3pt, ls 180% |
| - | 휴먼명조 15pt (sp −2…−4%) | both, lead 4 spaces, ls 160–180% |
| 표 헤더(도표) | 맑은 고딕 10pt bold | fill `#ecf2fa` or `#dfe6f7` |
| 예산표 | HY중고딕 11pt bold header / 10–11pt body | fill `#e5e5e5` |
| 붙임 서식 | 나눔고딕 14pt bold | ls 140% |

Budget table `#27` 14r×4c: 구  분 131.6 | 금  액 66.0 | 산 출 기 초 251.4 | 비 중 33.0; header fill `#e5e5e5`, HY중고딕 11pt bold. 산출기초 cells use `▪` bullets at 10pt.
Schedule table `#17` 8r×5c: 추진내용 152.8 | 월 columns 67.3 each; arrows `→` in `#092e99`.

### File 5 — `6. 2026년 안동시 수출기업 역량강화 지원사업 사업계획(안).hwp`

Numbering style: Roman band `Ⅰ … Ⅵ`, sub-bands `사업개요 / 추진일정 / 기대효과` chips, then `□ → ㅇ → - → ·`, plus `󰊱 󰊲` for major sub-programs and `❶ ❷` for enumerated 지원내용.

Outline:
```
[결재 블록]
2026년 안동시 수출기업 역량강화 지원사업 사업계획(안)   HY헤드라인M 20pt #000094
<사업계획 요약>  (3×3 frame) — 사업개요 / 추진일정 / 기대효과 chips (1×2, #203a7b + #d9d9d9)
Ⅰ 추진배경 및 현황
   [❖ 목적 박스 1×1 fill #dfe6f7, 맑은 고딕 15pt sp−4% w97%]
   □ 추진배경 → ㅇ ×5
   □ 지원현황 → ㅇ ×2  [표 6×4 구분/2023년/2024년/2025년]
Ⅱ 사업개요 및 추진절차
   □ 사업개요 → ㅇ 사 업 명/사업기간/사 업 비/지원대상/사업규모/지원내용(❶❷)/지원한도
   □ 추진절차  [표 8×5 흐름도]
Ⅲ 세부 추진계획
   󰊱 수출매뉴얼 지원
       □ 사업내용 → ㅇ 지원내용/지원규모/지원금액/지원자격  [표 9×3 구분/내용/비고]
       □ 지원분야 → ㅇ 세부지원내용  [표 12×4 분 야/매뉴얼 사업/지원내용/비고]  ※ ×2
       □ 참여기업 모집 → ㅇ 공고기간/공고방법/신청방법/제출서류  [표 14×4 구분/서류명/비고]
       □ 참여기업 선정 → ㅇ 선정방법 / ㅇ 평가기준(정량평가)  [표 7×3 평가항목/평가내용/배점] + [표 2×6 ×5]
   󰊲 수출직불금 지원   (same □ 구조)
Ⅳ 지원금 지급 및 정산
   󰊱 / 󰊲  → ㅇ 지원금 지급 → - → ·  / ㅇ 지원금 지급 제외 또는 환수 → -
Ⅴ 기대효과   ㅇ ×2
Ⅵ 소요예산   ㅇ 소요예산: 금60,000,000원(금육천만원)  [표 8×5]  ㅇ 예산과목
```

Level styles:

| Level | Char shape | Para shape |
|---|---|---|
| 표지 제목 | HY헤드라인M 20pt `#000094` | ls 100% |
| 장 | HY헤드라인M 20pt bold `#ffffff` / 18pt | 1×3 band, `#003366`, identical geometry to File 2 |
| 요약 chip | HY헤드라인M 15pt (bold sp−5% w96%) | 1×2, c0 13.9pt `#203a7b`, c1 442.4pt `#d9d9d9`, cellspacing 198 |
| □ | **HY헤드라인M 15pt bold** | both, lead 0, ls 135% |
| ㅇ | 휴먼명조 15pt (width 95%) | both, lead 1 space, ls 135% |
| - | 휴먼명조 15pt | left, lead 3 spaces, ls 135% |
| · | 휴먼명조 15pt | left, lead 4 spaces, ls 135% |
| ※ / * | 한양중고딕 12pt (sp −4…−19%) | both, ls 148–160% |
| 󰊱 절 제목 | HY헤드라인M 15pt bold sp−7% (17pt in Ⅳ) | ls 135–160% |
| 표 헤더 | 맑은 고딕 11–12pt bold | fill `#d9d9d9` |
| 표 본문 | 맑은 고딕 11–12pt | |
| (단위:천원) | 굴림체 10pt | merged top row of the 예산표 |

Budget table `#30` 8r×5c: 구 분 (2 merged: 50.1 + 86.9) | 산출 내역 218.7 | 금액 61.2 | 비고 61.2; header fill `#d9d9d9`, 맑은 고딕 11pt bold; 산출내역 uses `∙` bullets.

Distinctive: this is the only file with a `<사업계획 요약>` one-page executive summary built from a 3×3 outer frame plus three chip tables.

## 3. The common design system ("house style")

Files 1, 2, 4, 5 are one house (경상북도경제진흥원). File 3 is a separate authoring convention. Where they differ, files 2/4/5 are the majority and the most recent.

### 3.1 Font stack

| Role | House font | Size | Notes |
|---|---|---|---|
| 표지 제목 | **HY헤드라인M** | 20–28 pt | color `#000094` (files 4, 5) or `#3c32cd` (file 2); letter spacing −6…−10% |
| 장 번호 (Ⅰ) | **HY헤드라인M** bold | 20 pt | `#ffffff` on `#003366` |
| 장 제목 | **HY헤드라인M** | 18 pt | `#000000` |
| 절 번호/제목 | **HY헤드라인M** | 15 pt | `#ffffff` on `#203a7b` + `#d9d9d9` |
| □ 1-level bullet | **휴먼명조 bold** (files 1,2,4) or **HY헤드라인M bold** (file 5) | 15 pt | |
| ㅇ / ○ / ◦ 2-level | **휴먼명조** regular | 15 pt | width 95–100% |
| - 3-level | **휴먼명조** regular | 15 pt | |
| · 4-level | **휴먼명조** regular | 15 pt | |
| ※ / * 주석 | **한양중고딕** | 12 pt | files 2, 5; file 1 uses 휴먼명조 15pt |
| 표 헤더 | **맑은 고딕 bold** (files 2,4,5) or **HY중고딕 bold** (file 1) | 10–12 pt | |
| 표 본문 | **맑은 고딕** or **HY중고딕** | 9–12 pt | |
| 예산표 | **HY중고딕** (file 4) / **맑은 고딕** (files 2,5) | 10–11 pt | |
| 결재란 | **돋움** | 10 pt | fixed, identical in all 5 files |

Canonical stack to reproduce: `HY헤드라인M` (headings) + `휴먼명조` (body) + `맑은 고딕` (tables) + `한양중고딕` (notes) + `돋움` (approval block). Every file also carries the Hancom defaults 함초롬바탕 / 함초롬돋움 in the FaceName table (used by the unmodified 바탕글 / 개요 1–10 styles) — include them for compatibility even though body text never uses them.

### 3.2 Heading level specification

```
L0  표지 제목
    HY헤드라인M 20–28pt, spacing −6…−10%, color #000094, align left, line 100%

L1  장 (Ⅰ Ⅱ Ⅲ …) — a 1-row × 3-col inline table, NOT a plain paragraph
    table width  48110 HWPUNIT (481.1pt), cellspacing 0, cell padding 140 HWPUNIT all sides
    col0  2990 HWPUNIT (29.9pt)   fill #003366, borders 0.5mm solid #003366 (all four)
                                   text "Ⅰ"  HY헤드라인M 20pt bold #ffffff, center, valign middle
    col1   560 HWPUNIT (5.6pt)    no fill, left border 0.5mm solid #003366
    col2 44560 HWPUNIT (445.6pt)  no fill, top + bottom borders 0.5mm solid #003366
                                   text " 추진배경 및 목적"  HY헤드라인M 18pt #000000
    The heading text lives ONLY in the table cells. The anchoring paragraph has no text of
    its own (verified: own-text is empty once TableControl descendants are excluded).
    Emit the heading once, inside the band table.

L2  절 (1 2 3 … or a named chip) — 1-row × 2-col inline table
    table width 48200 HWPUNIT (482.0pt), cellspacing 198 HWPUNIT, padding l/r 510, t/b 141
    col0 ~2570 HWPUNIT (25.7pt)  fill #203a7b, HY헤드라인M 15pt #ffffff
    col1 ~45040 HWPUNIT (450.4pt) fill #d9d9d9, HY헤드라인M 15pt #000000

L3  □   휴먼명조 15pt bold, 1 leading space, align both,
         space-before 5–8pt (file 4 uses 0 or 15pt), line spacing 135–180%
L4  ㅇ / ○ / ◦   휴먼명조 15pt, 2 leading spaces (file 5 uses 1),
         space-before 0–8pt, line spacing 135–180%
L5  -   휴먼명조 15pt, 3–4 leading spaces, space-before 0–6pt
L6  ·   휴먼명조 15pt, 4 leading spaces
NOTE ※ / *  한양중고딕 12pt, 1 leading space, space-before 3–10pt, line 100–160%
```

Line spacing is `linespacing-type="ratio"`. House values: **135%** (file 5), **140–160%** (file 2), **180%** (files 1, 4). If one number is needed, use **160%**; for dense multi-page plans use 135%.

Paragraph margins (`doubled-margin-left/right`) are **0** everywhere in the body. `align="both"` (justify) is the default; `left` is used for tight bullet lists; `right` only for the `(단위: 천원)` caption.

Letter spacing is applied per-run to make lines fit: common values −1%, −2%, −4%, −6%, −7%, −9%, −10%, −14%, −19%. Character width (`LetterWidthExpansion`) 90–98% is used the same way. Neither is systematic; default to 0% / 100% and only condense to prevent an ugly wrap.

### 3.3 Summary / 목적 box

1-row × 1-col inline table, full width (476–482 pt), cell padding 510 HWPUNIT l/r and 141 t/b (file 2 uses 566 all round).
- fill `#dfe6f7` (files 2, 5) — the standard
- text 맑은 고딕 15pt, spacing −4%, width 97%, marker `❖` (file 5) or none (file 2)
- file 1 variant: no fill, marker `◇`, HY중고딕 14pt spacing −3% width 95%

### 3.4 Table style

```
outer table borderfill: 0.12mm solid #000000 on all four sides (HWP default id 3/4)
cell borders          : 0.12mm solid #000000, or 0.12mm solid #808080 for grey-ruled tables
                        section rules 0.4mm / 0.5mm; header underline sometimes double 0.5mm
cell padding          : 141 HWPUNIT (1.41pt) for tight tables,
                        510 HWPUNIT (5.1pt) l/r + 141 t/b for text-heavy tables
cellspacing           : 0 (198 only for the L2 chip bands)
valign                : middle everywhere
repeat-header         : 1 on the table body
```

Fill palette (hex, in frequency order):

| Hex | Use |
|---|---|
| `#d9d9d9` | **standard header-row fill** (all 5 files) |
| `#f2f2f2` / `#f3f3f3` / `#e5e5e5` | subtotal / 계 rows, secondary header |
| `#dfe6f7` | summary box, soft-blue header (files 2, 3, 4, 5) |
| `#ecf2fa` | light blue header (file 4 도표) |
| `#003366` | chapter-number cell, navy |
| `#203a7b` | section-number cell, navy-indigo |
| `#f0f0f0`, `#e0e0e0` | 도식 boxes |
| `#faf3db`, `#fcf5e7` | highlight boxes (files 2, 3) |
| `#dfeaf5` | row-label column (file 3) |
| `#b6dde8` | accent (file 1) |
| `#ffffff` | explicit white |

Text colors other than black: `#ffffff` (on navy), `#000094` and `#3c32cd` (cover title), `#092e99` (schedule arrows), `#bd3d3d` (도식 labels).

### 3.5 Cover / approval block (identical in all five)

Two stacked inline tables at the very top of page 1:
1. `1r × 2c`, width ~476pt, borderfill 3 — both cells are textless; the right cell holds the agency logo as an embedded picture (one `ShapePicture` per file, all five). In file 1 the empty right cell still carries a charshape of 양재난초체M 20pt bold, spacing +28%, `#0000ff`, width 90% — a leftover from when the wordmark was typed rather than placed.
2. `12r × 11c` (file 3: 12×10), width ~479.6pt, cell padding 140 — the 결재란: 등록번호 / 담당 / 팀장 / 실장 / 본부장 직무대리 / 원장 / 등록일자 / 결재일자 / 공개구분 / 협조. Label cells ~47.8pt and 83.2pt wide, signature columns 55.0pt each. All text 돋움 10pt (labels bold), centered, `ls=310%` on the wrapper paragraph.

Then the cover title paragraph, then (files 2, 5) a summary block, then the first chapter band.

### 3.6 Numbering conventions

- Chapters: `Ⅰ Ⅱ Ⅲ Ⅳ Ⅴ Ⅵ` in a navy chip (files 2, 3, 4, 5). File 1 uses `1. 2. 3.` plain. **Use Roman chips.**
- Sections: `1 2 3 4` in a small navy chip on grey (file 4), or named chips (file 5), or `󰊱 󰊲` circled numerals (files 3, 5).
- Body levels, in order: `□` → `ㅇ` (files 2, 5) / `○` (file 1) / `◦` (file 4) → `-` → `·`. `ㅇ` (U+3147 hangul jamo) is the most common at level 2.
- Enumerations inside a bullet: `❶ ❷`, `①②③`, `1. 2.`
- Notes: `※` (policy caveats) and `*` (fine print), plus `∙` / `▪` inside 산출내역 cells.
- Labels in parentheses at the start of a bullet are the house idiom: `ㅇ (사업기간) 2026. 7. ~ 12.`, `□ (수혜대상) …`.
- Documents end with `.  끝.` on the last bullet (file 2).
- `한글 개요 1–10` built-in styles exist but are **unused**; everything is direct formatting on style `바탕글`.

## 4. Canonical 사업계획서 outline (synthesized)

```
표지 (page 1)
  ├ 결재란 (1×2 wordmark table + 12×11 approval grid, 돋움 10pt)
  ├ 문서 제목               HY헤드라인M 20–28pt #000094
  └ [선택] 사업계획 요약 박스 또는 요약 페이지
       ├ 사업개요 chip (1×2, #203a7b + #d9d9d9)
       ├ 추진일정 chip
       └ 기대효과 chip
[선택] 목   차              HY헤드라인M, 점선 탭 + 페이지 번호

Ⅰ 추진배경 및 목적 (또는 추진배경 및 현황 / 필요성)
   [목적 박스 1×1 fill #dfe6f7, 맑은 고딕 15pt, ❖ 또는 ◇ 2–3줄]
   □ 추진배경        ㅇ … (3–5)
   □ 추진목적        ㅇ … (2–3) → - …
   □ 지원현황/추진실적  ㅇ …    [표: 연도별 실적]

Ⅱ 사업개요 (및 추진체계 / 추진절차)
   □ 사업개요
       ㅇ 사 업 명 / 사업기간 / 사 업 비 / 사업대상(지원대상) / 사업규모 / 사업내용(지원내용) / 지원한도
   □ 추진체계 및 역할   [표: 기관별 역할]
   □ 추진절차          [흐름도 표]

Ⅲ 세부 추진계획
   1 (또는 󰊱) 세부사업 1
       □ 사업내용     ㅇ 지원내용 / 지원규모 / 지원금액 / 지원자격  [표: 자격요건]
       □ 지원분야     ㅇ 세부지원내용                              [표: 분야별 지원]
       □ 참여기업 모집 ㅇ 공고기간 / 공고방법 / 신청방법 / 제출서류  [표: 제출서류]
       □ 참여기업 선정 ㅇ 선정방법 / 평가기준                       [표: 평가항목·배점]
   2 (또는 󰊲) 세부사업 2 …
   n 사업 및 성과관리  □ (성과관리) …

Ⅳ 추진일정            [표: 일자 | 주요일정 | 비고  또는  추진내용 | 월별 ✓]

Ⅴ 소요예산
   ㅇ 소요예산: 금OOO,OOO,OOO원(금…원)
   (단위: 천원)  ← 맑은 고딕 10pt, 우측정렬
   [표: 구 분 | 산출 내역 | 금 액 | 비 고]  ※ 합계 행 fill #d9d9d9
   ※ 사업진행 상황에 따라 항목 간 변경 가능
   ※ 정산 관련 문구
   ㅇ 예산과목: (정책사업)… (단위사업)… (세부사업)…
   [선택] □ 기관별 예산배정 내역  [표]

Ⅵ 기대효과            ㅇ … (2–3)  마지막에 "…  끝."

[선택] 참고자료 / 붙임 (신청서·동의서 서식, 나눔고딕 14pt bold)
```

### Typical table shapes

| Table | Columns (pt, full width ≈ 476–482) | Header fill |
|---|---|---|
| 소요예산 (4-col) | 구 분 131.6 \| 금 액 66.0 \| 산 출 기 초 251.4 \| 비 중 33.0 | `#e5e5e5` |
| 소요예산 (5-col) | 구 분 50.1 + 86.9 \| 산출 내역 218.7 \| 금액 61.2 \| 비고 61.2; merged `(단위:천원)` row on top | `#d9d9d9` |
| 소요예산 (파트별) | 항목 47.1 \| 세부항목 112.2 \| 산출내역 184.8 \| 금액 87.2 \| 비고 44.8; 합계 row spans 3 | `#d9d9d9` |
| 추진일정 (날짜형) | 시작 69.0 \| `~` 26.5 \| 종료 69.0 \| 주요일정 252.1 \| 비고 56.9 | `#d9d9d9` |
| 추진일정 (간트형) | 추진내용 152.8 \| 월 67.3 × 4, cells hold `→` in `#092e99` | `#ecf2fa` |
| 역할분담 | 구분 121.6 \| 주요기능 및 역할 357.5 | `#d9d9d9` |
| 기관별 배정 | 구분 92.3 \| 총 사업비 78.9 \| 사업비 78.9 \| 운영비 78.9 \| 수수료 78.9 \| 비고 61.2 | `#d9d9d9`, 계 row `#f2f2f2` |
| 자격요건 | 구분 \| 내용 \| 비고 (3-col, 약 80 / 340 / 60) | `#d9d9d9` |
| 평가기준 | 평가항목 \| 평가내용 \| 배점 | `#d9d9d9` |
| 제출서류 | 구분(번호) \| 서류명 \| 비고 (4-col with a merged 업종 column) | `#d9d9d9` |
| 연도별 실적 | 구분 119.1 \| 연도 116.1 × 3 | `#d9d9d9` |

## 5. Generator checklist (HWPX)

1. A4 portrait, margins 20/20/15/15 mm, header/footer 10 mm, page number bottom-center with dashes.
2. Register FaceName entries for all 7 language slots: 휴먼명조, HY헤드라인M, HY중고딕, 맑은 고딕, 한양중고딕, 돋움, 굴림체, 함초롬바탕, 함초롬돋움, 양재난초체M.
3. Keep the stock 바탕글 + 개요 1–10 style table; author everything as direct formatting on 바탕글.
4. Body text: 휴먼명조 15pt, justify, left margin 0, first-line indent 0, line spacing 160% (135% for dense docs).
5. Indent levels with leading half-width spaces: `□` 1, `ㅇ` 1–2, `-` 3, `·` 4.
6. Chapter headings as the 1×3 navy band table; section headings as the 1×2 chip table. Exact widths and colors in §3.2.
7. Tables: 0.12mm black borders, header row `#d9d9d9` with 맑은 고딕 11–12pt bold, body 맑은 고딕 10–12pt, valign middle, repeat-header on, padding 141 (tight) or 510 l/r + 141 t/b (text-heavy).
8. `(단위: 천원)` caption right-aligned in 맑은 고딕 10pt directly above every money table.
9. `※` notes in 한양중고딕 12pt immediately after the table they qualify.
10. Close the document with `.  끝.`
