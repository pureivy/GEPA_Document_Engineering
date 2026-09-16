# GEPA 공고문 DESIGN SYSTEM — extracted from HWP binaries (pyhwp)

Source dir: `/Users/sangbumnam/Desktop/공고문, 보고서 등 작성`
PRIMARY: `6-1. [붙임1] 「2026년 안동시 수출기업 역량강화 지원사업」 참여기업 모집 공고안(수ᄎ.hwp`
Scratchpad artifacts: `/private/tmp/claude-501/-Users-sangbumnam-AI-Agents-git-GEPA-Document-Engineering/881222f8-400d-42c1-a64c-eca9e05c5e15/scratchpad/`
 - `6-1.xml` (full hwp5proc xml), `6-1.walk.jsonl` (document-order walk), `6-1.out2.txt` (readable outline, 689 lines)
 - `62/f1/f2/f3/f64` = same artifacts for 6-2, file 1, file 2, file 3, 6-4
 - `walk.py` (parser), `render2.py` (renderer), `spine.py` (comparison spine)
 - `61html/bindata/BIN0001.png` (GEPA logo), `BIN0002.jpg` (chevron arrow)

## Units
- CharShape `basesize`: 1/100 pt. 1300 = 13.0pt.
- HWPUNIT (ParaShape indent/margins, table/cell width+height, PageDef): 1/7200 inch.
  mm = HWPUNIT / 7200 * 25.4. 1mm = 283.465 HWPUNIT. 1pt = 100 HWPUNIT.
- `letter_spacing`: percent of em (−5 = −5%).
- ParaShape `linespacing` + `linespacing-type="ratio"` → percent. ALL files use ratio type; no fixed/at-least anywhere.
- Colors: pyhwp already resolves COLORREF to `#rrggbb`. Verified against hwp5html CSS.

## 1. PAGE SETUP (PageDef)
| file | paper | W×H HWPUNIT | left/right | top/bottom | header/footer |
|---|---|---|---|---|---|
| 6-1, 6-2, f1, f3 | A4 portrait | 59528 × 84188 (210×297mm) | 5669 = 20.0mm | 3600 = 12.7mm | 2834 = 10.0mm |
| f2 실라리안 | A4 portrait | 59528 × 84188 | 5669 = 20.0mm | 2834 = 10.0mm | 4251 = 15.0mm |
| 6-4 신청서 | A4 portrait | 59528 × 84186 | 5669 = 20.0mm | 4252 = 15.0mm | 2835 = 10.0mm |

Text column width = 59528 − 2×5669 = **48190 HWPUNIT = 170.0 mm**. Confirmed by LineSeg width=48188.
1 column (ColumnsDef count=1). Page number: bottom_center, no prefix/suffix, dash "-".
PageBorderFill: borderfill-id=12 (0.1mm #7f7f7f box), margins 1417 (5.0mm) all sides, relative-to=paper.
Explicit page breaks in 6-1 at top-level paragraphs 12, 83, 138 (`new-page="1"`), the last being `[별첨1]정량평가 기준`.

## 2. FONT TABLE (6-1, per-language, sliced by IdMappings)
ko-fonts=10 en=10 cn=11 jp=11 other=9 symbol=11 user=9 → 71 FaceName total (verified).
ko: 굴림, 돋움, 맑은 고딕, 바탕, 서울한강체 M, 휴먼명조, HY헤드라인M, 한양중고딕, #신문태명, 태-물방울R
en: 굴림, 돋움, 맑은 고딕, 바탕, 서울한강체 M, HY헤드라인M, #신문태명, 한양중고딕, HCI Poppy, 태-물방울R

Only 4 Hangul faces actually carry text in 6-1: **HY헤드라인M, 휴먼명조, 한양중고딕, 맑은 고딕** (+굴림 once).
Latin partner of 휴먼명조 is **HCI Poppy**; 한양중고딕/맑은 고딕/HY헤드라인M pair with themselves.

## 3. STYLE TABLE (6-1 — role → exact spec)
| role | cs# | ko face | latin | pt | bold | spacing | color | ps# | align | line-sp | indent |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 공고번호 line | 124 | HY헤드라인M | HY헤드라인M | 14.0 | no | 0 | #000000 | 18 | both | 125% | 0 |
| 공고 제목 (2 lines) | 51/75 | HY헤드라인M | HY헤드라인M | 20.0 | no | 0 | #000000 | 20 | center | 125% | 0 |
| 인사말 본문 | 17/76 | HY헤드라인M | HY헤드라인M | 15.0 | no | 0 | #000000 | 0 | both | 160% | 0 |
| 인사말 강조 | 77 | HY헤드라인M | HY헤드라인M | 15.0 | no | 0 | **#0000ff** | 0 | both | 160% | 0 |
| 날짜 | 0 | HY헤드라인M | HY헤드라인M | 16.0 | no | 0 | #000000 | 24 | right | 150% | 3000 |
| 날짜(붉은 부분) | 99 | HY헤드라인M | HY헤드라인M | 16.0 | no | 0 | **#ff0000** | 24 | right | 150% | 3000 |
| 기관장 | 0 | HY헤드라인M | HY헤드라인M | 16.0 | no | 0 | #000000 | 24 | right | 150% | 3000 |
| 섹션 제목바 텍스트 | 17 | HY헤드라인M | HY헤드라인M | 15.0 | no | 0 | #000000 | 2 | both | 160% | 0 |
| 본문 □ 1단계 | 8 | 휴먼명조 | HCI Poppy | 13.0 | no | 0 | #000000 | 4 | both | 160% | 0 |
| 본문 □ 강조(라벨) | 31/13/3 | 휴먼명조 | HCI Poppy | 13.0 | **yes** | 0 | #000000 | 4 | both | 160% | 0 |
| 본문 ㅇ 2단계 | 8 | 휴먼명조 | HCI Poppy | 13.0 | no | 0 | #000000 | 4 | both | 160% | 0 |
| 본문 - 3단계 | 8 | 휴먼명조 | HCI Poppy | 13.0 | no | 0 | #000000 | 4 | both | 160% | 0 |
| ※ 주석 (본문급) | 53 | 한양중고딕 | 한양중고딕 | 12.0 | no | 0 | #000000 | 0 | both | 160% | 0 |
| ※ 주석 (작은) | 73/74 | 한양중고딕 | 한양중고딕 | 11.0 | no | 0 | #000000 | 4 | both | 160% | 0 |
| * 각주 (굴림) | 58/59 | 굴림 | 굴림 | 11.0 | no | −4/−6 | #000000 | 31 | both | 150% | −4120 |
| 안내박스 □ 제목 | 65 | 한양중고딕 | 한양중고딕 | 15.0 | **yes** | −5 | #000000 | 25 | both | 160% | −4112 |
| 안내박스 ○ 항목 | 64 | 한양중고딕 | 한양중고딕 | 13.0 | no | −5 | #000000 | 30 | both | 160% | −5176 |
| 모집개요표 라벨 | 13 | 휴먼명조 | HCI Poppy | 13.0 | **yes** | 0 | #000000 | 22 | distribute | 160% | 0 |
| 모집개요표 값 | 8 | 휴먼명조 | HCI Poppy | 13.0 | no | 0 | #000000 | 4 | both | 160% | 0 |
| 절차도 헤더 | 15 | 맑은 고딕 | 맑은 고딕 | 11.0 | **yes** | 0 | #000000 | 5 | center | 130% | 0 |
| 절차도 값 | 16 | 맑은 고딕 | 맑은 고딕 | 11.0 | no | 0 | #000000 | 5 | center | 130% | 0 |
| 제출서류표 헤더 | 7 | 맑은 고딕 | 맑은 고딕 | 11.0 | **yes** | 0 | #000000 | 56 | center | 150% | 0 |
| 제출서류표 본문 | 6 | 맑은 고딕 | 맑은 고딕 | 11.0 | no | 0 | #000000 | 32 | center | 160% | 0 |
| 제출서류표 번호/비고 | 1 | 맑은 고딕 | 맑은 고딕 | 11.0 | no | −1 | #000000 | 57 | center | 150% | −2696, mr −100 |
| 지원내용표 헤더 | 84/85 | 맑은 고딕 | 맑은 고딕 | 11/10 | **yes** | −5/0 | #000000 | 56/71 | center | 150/130% | 0 |
| 지원내용표 본문 | 86/87 | 맑은 고딕 | 맑은 고딕 | 10.0 | no | 0/−13 | #000000 | 70 | both | 130% | 0 |
| 평가표 헤더/항목 | 100 | 맑은 고딕 | 맑은 고딕 | 11.0 | **yes** | 0 | #000000 | 43/74 | center | 100/120% | 0 |
| 평가표 소표 | 104 | 맑은 고딕 | 맑은 고딕 | 10.0 | no | 0 | #000000 | 78 | center | 160% | −2896 |
| 평가표 소각주 | 107 | 맑은 고딕 | 맑은 고딕 | 9.0 | **yes** | −1 | #000000 | 74 | center | 120% | 0 |

Named HWP Styles present (19): Normal 바탕글 (cs10/ps4), Body 본문 (cs18/ps7), Outline 1–7,
Page Number, Header, Footnote, 본문(휴명16), 본문-13, 신문태명조14, xl65, 표제목, td, xl111.
The document does NOT apply these — every paragraph uses style-id 0 with direct cs/ps overrides.

### CRITICAL: indentation is typed spaces, not margins
`doubled-margin-left` is **0 on every body paragraph**. The dominant body ParaShape is **ps4
(align=both, linespacing 160% ratio, indent 0, all margins 0)** used 47×. The visual bullet
ladder comes from literal leading space characters in the text run:
```
□ …            (col 0, no leading space)
 ㅇ …           (1 leading space)
   - …          (3 leading spaces)
  ※ …           (2 leading spaces)
    * …         (4 leading spaces)
```
Negative `indent` values (−4112, −5176, −5192 …) are per-paragraph hanging-indent artifacts left by
the author; they vary paragraph-to-paragraph and are NOT a systematic ladder. For faithful
regeneration, reproduce the literal spaces; the indent values can be copied verbatim per paragraph
from `6-1.walk.jsonl` if byte-level fidelity is required.

## 4. COLOR PALETTE (all 27 shaded BorderFills)
| hex | role |
|---|---|
| #47b0bb | GEPA teal — section-bar gradient start, 모집개요 table 0.4mm rules |
| #d0eaed | gradient end of section bar |
| #e7f4f6 | 모집개요 table label-column fill (pale teal) |
| #fbfaf7 | page-1 안내박스 fill (warm off-white) |
| #dfe6f7 | 제출서류/지원내용 header fill, 절차도 value row (pale blue) |
| #bfbfbf | 절차도 header row fill (grey) |
| #d9d9d9 | 정량평가표 header + 합계 row, nested score tables |
| #ffffff | 정량평가표 body cells (explicit white) |
| #3a3c84 | 정량평가표 border colour (navy) |
| #808080 | 절차도 borders 0.4mm |
| #cccccc | nested score-table inner borders 0.12mm |
| #7f7f7f | page border 0.1mm |
| #ffe7d8 | (f2 실라리안 only) 안내박스 fill — peach |

Text colors used: #000000 (default), #0000ff (인사말 강조), #ff0000 (날짜 강조, 우대지원 강조),
#3057b9 (동점시 처리 문구 일부).

## 5. ELEMENT-BY-ELEMENT WALK OF 6-1 (document order)

### PAGE 1 — cover block
1. `(재)경상북도경제진흥원 공고 제2026070000호` — ps18 both 125%, cs124 HY헤드라인M 14pt
2. (blank, ps23 center 105%)
3. `「2026년 안동시 수출기업 역량강화 지원사업」` ⏎(line break) `참여기업 모집 공고(수출매뉴얼 지원)`
   — ps20 center 125%, cs51/75 HY헤드라인M 20pt. Single paragraph, LINE_BREAK between.
4. (blank ps0)
5. 인사말: `  안동시와 (재)경상북도경제진흥원에서 추진하는 「…」참여 기업을 모집하오니 안동시 내
   수출유망 중소기업의 많은 참여를 바랍니다.` — ps0 both 160%, cs17 HY헤드라인M 15pt (2 leading spaces)
6. (blank ps0)
7. `2026. 07.` — ps24 right 150% indent 3000, cs0 HY헤드라인M 16pt (padded with spaces, trailing spaces)
8. `(재)경상북도경제진흥원장` — ps24 right 150%, cs0 HY헤드라인M 16pt
9. 2× blank ps24
10. **안내박스 (TableControl)** — 1×1, w=47624 (168.0mm), h=27822 (98.1mm),
    halign=left, flow=block, inline=0, margins 283 all round (1.0mm), cell padding l/r=510 (1.8mm)
    t/b=141 (0.5mm), valign=middle.
    Table BF4 (solid 0.12mm #000000 all); **cell BF14: fill #fbfaf7, dotted 0.12mm #000000 all 4 sides**.
    Contents (한양중고딕 throughout):
    ```
    □ 접수방법                      cs65 15pt bold sp−5, ps25
     ○ 이메일 접수: gepa_north@naver.com     cs64 13pt sp−5 / email cs8 휴먼명조 13pt, ps30
     ○ 우편(등기): 경상북도 안동시 북순환로 387, 2층 경상북도경제진흥원
    (blank)
    □ 문의                          cs65 15pt bold
     ○ 사업 및 신청서 작성 문의: ⏎북부지소 ☎ 054-900-3801 (E-mail) gepa_north@naver.com
     ○ 본 공고와 관련하여 이의사항이 있는 경우에는 사업부서 및 진흥원 홈페이지(고객의소리,
       국민신문고)를 통하여 의견을 제시할 수 있음        ps50
    (blank)
    □ 선정결과 통보                  cs65 15pt bold
     ○ 기업별 개별통보(필요시 접수 홈페이지 공고)
    ```
11. 2 blanks → **PAGE BREAK** (top-level para 12, new-page=1)

### PAGE 2+
12. **IMG BIN0001** — GEPA logo PNG 545×78px. Placed inline=1, halign=left, w=26154 (92.3mm)
    × h=3762 (13.3mm). ShapeComponent initial 87180×12540, scaler matrix 0.3 → uncropped, 30% scale.
    z-order 12. This is the running header mark that opens the body.
13. blank ps39
14. **SECTION BAR: `1. 모집개요`** — see §6 for the exact recipe.
15. 2 blanks ps0
16. **모집개요 표** — 11 rows × 4 cols, w=48341 (170.5mm), h=28530 (100.6mm), inline=1, halign=left,
    cell padding l/r=510, t/b=141, valign=middle.
    Column widths: c0=2284 (8.1mm) bullet `○`, c1=13321 (47.0mm) label, c2=1303 (4.6mm) `:`,
    c3=31433 (110.9mm) value.
    Row borderfills: r0 = BF15/BF16 (top solid 0.4mm **#47b0bb**, bottom dotted 0.12mm #000000);
    r1–r6 = BF17/BF18 (top+bottom dotted 0.12mm); r7 = BF19/BF20 (bottom solid 0.4mm #47b0bb);
    r8 = BF11 spacer row h=1865 (top+bottom solid 0.4mm #47b0bb, no fill);
    r9 = BF21/BF22 (bottom dotted); r10 = BF19/BF20 (bottom solid 0.4mm #47b0bb).
    Label columns c0/c1/c2 carry fill **#e7f4f6**; value column c3 has NO fill.
    Left and right outer borders of every cell are `none` → the table reads as horizontal rules only.
    Row heights 2355 (r0–r7), 1865 (r8), 2219 (r9–r10).
    Rows: 사업명 / 선정방법 / 사업내용 / 지원기간 / 지 원 대 상 / 대상자별지원금액 /
    신청방식 / 모집규모 / (spacer) / 신청서접수일자 / 신청서접수마감일자.
    Labels use ps22 `distribute` alignment (글자 양쪽 정렬) — this is what produces `지 원 대 상`.
17. 3 blanks
18. **SECTION BAR: `2. 지원절차`**
19. **절차도 표** — 2 rows × 5 cols, w=48181 (169.8mm), h=21.1mm.
    c0/c2/c4 = 50.5mm stage boxes; c1/c3 = 8.6mm / 9.6mm arrow columns (rowspan 2)
    holding **IMG BIN0002** (chevron JPG 20×20px) at 5.0mm × 5.0mm, inline=1.
    r0 BF23: fill **#bfbfbf**, borders l/t/r solid 0.4mm **#808080**, bottom none. cs15 맑은 고딕 11pt bold, ps5 center 130%.
    r1 BF24: fill **#dfe6f7**, borders l/r/b solid 0.4mm #808080, top none. cs16 맑은 고딕 11pt, center.
    Arrow cells BF10: l/r solid 0.4mm #808080 only.
    Content: 모집공고 / ’26. 07. 00.  →  신청·접수 / ’26. 07. 00. ~ 07. 00.  →  평가(서면) / 8월 중순
20. `※ 상기 일정은 추진 상황에 따라 변경될 수 있음` — ps0 both 160%, cs53 한양중고딕 12pt
21. **SECTION BAR: `3. 사업목적`** → three `□` paragraphs (cs8 휴먼명조 13pt, ps4) with blank between each
22. **SECTION BAR: `4. 사업기간`** → `□ (사업기간) 선정일로부터 ~ 10. 31.까지` (label `(사업기간)` is cs3 bold)
23. **SECTION BAR: `5. 신청자격`** → `□ (지원대상) …` + ㅇ/- ladder + `□ (참여제한대상)` + 7× `◦` items
24. **SECTION BAR: `6. 신청방법`** → `□ 신청·접수` (cs31 bold), ㅇ 접수기간/접수방법, `□ 제출서류`
25. **제출서류 표** — 14 rows × 4 cols, w=48446 (171.0mm), h=145.9mm.
    Columns: No 10.6mm / 제 출 서 류 75.4mm / 제출부수 19.5mm / 비 고 사 항 65.5mm.
    Header r0 BF29/30/32: fill **#dfe6f7**, top solid **0.5mm** #000000, bottom 0.1mm. cs7 맑은 고딕 11pt bold.
    Body BF4/7/8/9: solid 0.12mm #000000 grid. Last row r13 BF25/26/27: bottom solid **0.5mm**.
    c0 left border `none`, c3 right border `none` (outer frame comes from tblBF4).
    rowspan: r1c3 spans 4 rows (`[서식집] 양식 사용`); r7c0 spans 2; r7c3 spans 2.
    13 numbered 서류 rows.
26. `* 건축물관리대장: …` 2-line footnote — ps31 both 150% indent −4120, cs58 **굴림 11pt sp−4**
27. **SECTION BAR: `7. 선정절차`** → □ (선정방법) … ※ … ㅇ 서류심사 / ㅇ 현장점검 / ㅇ 후순위 / □ (선정결과 안내)
28. **SECTION BAR: `8. 지원내용`** → `□ (지원내용)수출 매뉴얼사업(4개 분야 11개 사업)` (cs31 bold)
29. **지원내용 표** — 12 rows × 4 cols, w=47223 (166.2mm), h=84.5mm, **cell padding 0/0/0/0**,
    table BF33 (no borders at all — the frame is per-cell).
    Columns: 분 야 48.7mm / 매뉴얼 사업 75.2mm / 지원금액 21.1mm / 비고 21.2mm.
    Header r0 BF39/40/41: fill **#dfe6f7**, top solid 0.4mm #000000, others 0.12mm. cs84 11pt bold / cs85 10pt bold.
    Body 맑은 고딕 10pt (cs86/87). Category cells rowspan 4/2/4/1 (Ⅰ.수출용 홍보물 제작,
    Ⅱ.제품생산 지원, Ⅲ.마케팅 지원, Ⅳ.디자인 개발 지원). c2 rowspan 11 = `3백만원 한도 / 공급가액의 /
    최대 80% / (VAT 제외)`. Bottom row borders solid 0.4mm.
30. 2× `※` notes (cs92 한양중고딕 12pt), `□ (지원한도) …`, ㅇ/※/- ladder, `□ 지원금 지급 방법` + 4 ㅇ
31. **SECTION BAR: `9. 기타 유의사항`** → 6× `ㅇ` paragraphs (cs8 휴먼명조 13pt, ps4)
32. **PAGE BREAK** → `[별첨1]정량평가 기준` (ps4, cs31 휴먼명조 13pt bold)
33. **정량평가 표** — 7 rows × 3 cols, w=47795 (168.5mm), h=229.8mm, cell padding 0.
    Columns: 평가항목 23.4mm / 평가내용 130.2mm / 배점 14.8mm.
    Header BF43/44/45: fill **#d9d9d9**, top solid 0.4mm **#3a3c84**, others 0.12mm #3a3c84.
    Body BF46/47/54/55: fill #ffffff, borders 0.12mm #3a3c84.
    합계 row r6: c0 colspan 2, fill #d9d9d9, bottom solid 0.4mm #3a3c84.
    Rows: 수출실적[30] / 매출성장률 / 매출액 / 안정성 / 우대지원[10] / 합 계.
    Each 평가내용 cell nests a **2×6 score table** (w=117.1mm): header fill #d9d9d9, outer borders
    solid 0.25mm #000000, inner 0.12mm **#cccccc**; cs104 맑은 고딕 10pt, ps78 center 160% indent −2896.

## 6. THE SECTION TITLE BAR — exact recipe (the house signature)
A **2-row × 1-column TableControl**, inline=1, halign=left, flow=block:
- table width **48190 HWPUNIT = 170.0 mm** (exactly the text column)
- table BorderFill = BF4 (solid 0.12mm #000000) but both cells override to no borders → invisible frame
- cell padding l/r/t/b = 141 (0.5mm) each
- **row 0**: height 2848 HWPUNIT (**10.0 mm**) — occasionally 2565 (9.0mm) for sections 7 and 8.
  BorderFill: **no fill, no borders** (6-1 BF6; 6-2/f1 BF7; f3 BF5).
  Paragraph ps2 (align=both, linespacing 160% ratio, indent 0, margins 0),
  CharShape cs17 = **HY헤드라인M 15.0pt, bold=0, spacing 0, #000000**. Text `N. 제목`.
- **row 1**: the teal strip. BorderFill = no borders, **FillGradation**:
  `gradation-type="linear"`, `shear="90"`, `blur="50"`, `blur-center="50"`, `type="01"`,
  center (0,0), colors **#47b0bb → #d0eaed**. Contains one empty paragraph ps2.
  **HEIGHT: the stored cell attribute is `height="0"` (auto/minimum) — do NOT emit 0.**
  The rendered row height is `tableHeight − row0Height` = **482 HWPUNIT = 1.70 mm**, and this is
  constant across all 21 section bars in 6-1, 6-2, file 1 and file 3. Of those 482, the cell's own
  top+bottom padding is 141+141 = 282, leaving a 200-unit line box; the fill paints the full cell
  rectangle, so the **visible teal strip is 1.70 mm tall**.
  Table height is therefore 2848 + 482 = **3330** (11.75mm) for the 10.0mm-title variant, and
  2565 + 482 = **3047** (10.75mm) for the 9.0mm-title variant (6-1 sections 7 and 8; 6-2 sections 5, 7, 8).

This gradient strip is **byte-identical in 6-1, 6-2, file 1 and file 3** (same colors, shear, blur).
It is the single strongest GEPA house-style marker. File 2 (실라리안) does not use it at all.

## 7. IMAGES
| id | file | pixels | placed size | placement |
|---|---|---|---|---|
| BIN0001 | PNG RGBA | 545×78 | 26154 × 3762 HWPUNIT = **92.3 × 13.3 mm** | inline=1, halign=left, immediately after the page-1 안내박스 / page break, before `1. 모집개요`. Scale matrix 0.3 on initial 87180×12540. z-order 12. GEPA wordmark + 경상북도경제진흥원 + Gyeongbuk Economic Promotion Agency |
| BIN0002 | JPEG | 20×20 | 6900 × 6900 → **5.0 × 5.0 mm** | inline=1 inside the 지원절차 flow table arrow columns (2 instances), rowspan-2 cells, centered. Triple-chevron `⋙` |

Logo width differs per document: 6-1 = 92.3mm, 6-2 = 95.2mm, f1 = 76.1mm, f2 = 78.2mm, f3 = 92.3mm.
Same BIN0001 asset in all five.

## 8. REUSABLE TEXT TEMPLATE (6-1 skeleton with placeholders)

```
(재)경상북도경제진흥원 공고 제{{공고번호}}호
                                                  ← ps18 both 125%, HY헤드라인M 14pt

「{{사업명}}」⏎{{모집대상}} 모집 공고({{부제}})
                                                  ← ps20 center 125%, HY헤드라인M 20pt

  {{주관기관}}와 (재)경상북도경제진흥원에서 추진하는 「{{사업명}}」{{모집대상}}을 모집하오니
  {{지역}} 내 {{대상기업군}}의 많은 참여를 바랍니다.
                                                  ← ps0 both 160%, HY헤드라인M 15pt, 2 leading spaces

                                        {{공고연월}}          ← ps24 right 150%, HY헤드라인M 16pt
(재)경상북도경제진흥원장                                 ← ps24 right 150%, HY헤드라인M 16pt

┌ 안내박스 1×1  168.0mm × {{높이}}  fill #fbfaf7  dotted 0.12mm #000000 ───────────┐
│ □ 접수방법                                      ← 한양중고딕 15pt bold sp−5
│  ○ 이메일 접수: {{접수이메일}}                     ← 한양중고딕 13pt sp−5
│  ○ 우편(등기): {{우편주소}}
│
│ □ 문의
│  ○ 사업 및 신청서 작성 문의: ⏎{{부서명}} ☎ {{전화}} (E-mail) {{이메일}}
│  ○ 본 공고와 관련하여 이의사항이 있는 경우에는 사업부서 및 진흥원 홈페이지
│    (고객의소리, 국민신문고)를 통하여 의견을 제시할 수 있음        ← FIXED BOILERPLATE
│
│ □ 선정결과 통보
│  ○ {{선정결과통보방법}}
└──────────────────────────────────────────────────┘
                                                  ← PAGE BREAK

[GEPA 로고 이미지 92.3 × 13.3 mm, 좌측 정렬]

■■ 1. 모집개요 ■■  (170.0mm bar, HY헤드라인M 15pt + #47b0bb→#d0eaed gradient strip)

┌ 모집개요표 11×4 170.5mm ────────────────────────────┐
│ ○ │ 사업명            │ : │ {{사업명}}                  │
│ ○ │ 선정방법          │ : │ {{선정방법}}                 │
│ ○ │ 사업내용          │ : │ {{사업내용}}                 │
│ ○ │ 지원기간          │ : │ {{지원기간}}                 │
│ ○ │ 지 원 대 상       │ : │ {{지원대상}}                 │
│   │ 대상자별지원금액  │ : │ {{지원금액}}                 │
│ ○ │ 신청방식          │ : │ {{신청방식}}                 │
│ ○ │ 모집규모          │ : │ {{모집규모}}                 │
│ (spacer row h=1865)                                │
│ ○ │ 신청서접수일자    │ : │ {{접수시작일}}               │
│ ○ │ 신청서접수마감일자│ : │ {{접수마감일}}               │
└────────────────────────────────────────────────────┘

■■ 2. 지원절차 ■■

┌ 절차도 2×5 169.8mm ────────────────────────────────┐
│ {{단계1}} │⋙│ {{단계2}} │⋙│ {{단계3}}                │  fill #bfbfbf, 맑은 고딕 11pt bold
│ {{일정1}} │  │ {{일정2}} │  │ {{일정3}}                │  fill #dfe6f7, 맑은 고딕 11pt
└────────────────────────────────────────────────────┘
※ 상기 일정은 추진 상황에 따라 변경될 수 있음          ← FIXED BOILERPLATE, 한양중고딕 12pt

■■ 3. 사업목적 ■■
□ {{목적1}}
□ {{목적2}}
□ {{목적3}}

■■ 4. 사업기간 ■■
□ (사업기간) {{사업기간}}

■■ 5. 신청자격 ■■
□ (지원대상) {{지역}} 소재 사업장을 둔 중소기업으로 아래 요건을 충족하는 기업
 ㅇ 「중소기업기본법」상의 중소기업으로 공장등록증을 보유하고 신청일 현재 가동 중인 기업체
 ㅇ 「중소기업기본 진흥에 관한 법률」에 의한 중소기업으로서 건축법상 건축물 대장 용도가
    “공장” 또는 “제조업소”인 기업
    ※ 한국표준산업분류 대분류(C)제조업(10~34)에 해당되는 기업
 ㅇ 무역업 고유번호를 가진 기업
 ㅇ 우대업체: 최근 {{n}}년 내 {{지역}} 및 경상북도 선정 유망 중소기업
   - 가족친화인증기업, 여성기업, 사회적기업, 장애인기업, 실라리안, 경북pride기업,
     향토뿌리기업, 벤처기업, 마을기업, 일자리창출 우수기업, 산불피해기업(재해기업확인서),
     미국, 중동 정세 피해기업
 ㅇ 전년도 {{사업명}} 참여기업 후순위
□ (참여제한대상)                                   ← FIXED BOILERPLATE BLOCK (7 items):
 ◦ 한국표준산업분류 대분류 N. 사업시설 관리, 사업지원 및 임대서비스업, 생산도급
   (단순노무 도급, 생산기반시설 없는 경우) 기업, 근로자 파견 및 공급업체
 ◦ 휴업 중인 기업
 ◦ 금융기관과 정상적인 거래를 할 수 없는 기업
 ◦ 신청일 기준 현재 국세 및 지방세 체납기업
 ◦ 사회적 물의를 일으킨 기업(임금체불, 불법행위 등)
 ◦ 기타 본 사업에 적정하지 않다고 판단되는 경우
 ◦ 기타 유사사업 참여기업 일부 제한

■■ 6. 신청방법 ■■
□ 신청·접수
 ㅇ (접수기간) {{접수기간}} 18:00 제출분에 한하여 유효
 ㅇ (접수방법) 우편 접수 또는 이메일 접수({{이메일}})
   - 신청서류를 하나의 문서로 스캔(pdf파일)하여 제출
□ 제출서류
┌ 제출서류표 14×4 171.0mm ─ header fill #dfe6f7 ─────┐
│ No │ 제 출 서 류 │ 제출부수 │ 비 고 사 항          │
│ 1..13 …                                            │
└────────────────────────────────────────────────────┘
 * 건축물관리대장: 공장건축면적이 500㎡ 이하이고 주용도가 공장 또는 제조업소,
   제2종근린시설로 기재된 {{지역}} 소재 기업의 경우, 공장등록증 대신
   건축물관리대장으로 제출                          ← 굴림 11pt sp−4

■■ 7. 선정절차 ■■
□ (선정방법) 서류평가 고득점 순으로 {{n}}개사 내외 선정
  ※ 예산상황에 따라 선정기업은 변동될 수 있음         ← FIXED BOILERPLATE
 ㅇ 서류심사: 평가 기준표에 따라 서면평가
   - 평가기준: {{평가기준목록}}
  ※ 동점시 {{동점처리순서}} 순으로 참여기업 우선 선정
 ㅇ 현장점검: 현장확인이 필요할 경우 실시
 ㅇ 전년도 {{사업명}} 참여기업 후순위
□ (선정결과 안내)
 ㅇ 진흥원 홈페이지 공지 및 개별통보

■■ 8. 지원내용 ■■
□ (지원내용){{지원내용요약}}
┌ 지원내용표 {{n}}×4 166.2mm ─ header fill #dfe6f7 ──┐
│ 분 야 │ 매뉴얼 사업 │ 지원금액 │ 비고             │
└────────────────────────────────────────────────────┘
□ (지원한도) 기업별 최대 {{한도}} 지원
 ㅇ 총 소요금액의 {{비율}}%지원 (총 소요금액의 {{잔여}}%, 부가세 기업 부담)
  ※ 최대 지원한도에 따라 기업부담금 증가할 수 있음    ← FIXED BOILERPLATE
□ 지원금 지급 방법
 ㅇ 선정기업 개별 비용 선 결제 후 제출한 결과보고서와 청구서를 검토하여 증빙서류 확인 후
   인정금액 기업게좌로 직접 송금                     ← FIXED BOILERPLATE (typo 게좌 preserved)
 ㅇ 위 지원항목 중 타 기관 사업을 통해 수혜받은 동일한 항목 신청 불가
 ㅇ 간이영수증, 현금지급은 인정하지 않음

■■ 9. 기타 유의사항 ■■                              ← ENTIRE BLOCK IS FIXED BOILERPLATE
 ㅇ 참여 기업은 자격요건 등이 적합한지를 정확히 확인한 후 신청
 ㅇ 제출된 서류는 반환하지 않으며, 제출된 서류에 기재된 내용이 사실과 다를 경우
   선정이 취소될 수 있음
 ㅇ 최종 선정 공지 이후라도 자격조건 검증 과정 등을 통하여 결격사유가 확인될 경우
   선정이 취소될 수 있음
 ㅇ 사업 선정(심사)위원회 구성, 선정결과(점수 포함), 합격 또는 탈락 사유 등 심사와
   관련한 일체의 정보는 비공개를 원칙으로 함
 ㅇ 상기 유의사항 또는 공고 내용의 미숙지에 따른 책임은 신청인에게 있으며, 이에 대한
   해석이 상이할 경우는 {{주관기관}} 또는 경상북도경제진흥원의 해석에 따름
 ㅇ 본 공고문은 사정에 의하여 변경될 수 있으며, 변경된 사항은 (재)경상북도경제진흥원
   홈페이지(www.gepa.kr)에 공고 예정        ← www.gepa.kr is a FieldHyperLink, see §12
                                                  ← PAGE BREAK
[별첨1]정량평가 기준
┌ 정량평가표 7×3 168.5mm ─ #3a3c84 borders, #d9d9d9 header ──┐
│ 평가항목 │ 평가내용 │ 배점 │  + nested 2×6 배점표 per row  │
└────────────────────────────────────────────────────────────┘
```

## 9. COMPARISON ACROSS THE FIVE 공고문

### Common to all GEPA 공고문 (the invariant house style)
1. A4 portrait, left/right margin **20.0mm**, text column **170.0mm**.
2. Cover block in fixed order: 공고번호 (HY헤드라인M 14pt, both-aligned) → blank → 제목
   (HY헤드라인M 20pt centered, often 2 lines) → 인사말 (HY헤드라인M 15pt, 2 leading spaces,
   justified) → 연월 (HY헤드라인M 16pt right) → `(재)경상북도경제진흥원장` (16pt right).
3. Page-1 **안내박스**: 1×1 table, 168–169mm wide, **dotted 0.12mm #000000** border,
   pale fill, containing `□ 접수방법` / `□ 문의` / `□ 선정결과 통보` with 15pt bold headings
   and 13–14pt items. Present in all five, identical skeleton.
4. GEPA logo (BIN0001, 92.3 × 13.3 mm) **pinned to the bottom of page 1** (out-of-flow picture: `treatAsChar=0`, `vertRelTo=PAGE vertAlign=BOTTOM`, `horzRelTo=PAGE horzAlign=CENTER`; `image.position: "pageBottom"`), then the page break (user decision 2026-09-16). The 안내박스 no longer carries the 이의제기 sentence (it stays in 9. 기타 유의사항).
5. `□ / ㅇ (or ○/❍/◦) / - / ※ / *` bullet ladder rendered with **literal leading spaces**,
   margin-left 0, justified, ratio line spacing.
6. Every 공고문 opens its body with a **1. 사업개요 / 모집개요** table (≈170mm) using the
   `○ | 라벨 | : | 값` 4-column pattern with `distribute` alignment on labels.
7. A **추진절차 / 지원절차** flow table with chevron arrow images between grey-header /
   blue-value stage boxes, followed by `※(또는 *) 상기 일정은 추진 상황에 따라 변경될 수 있음`.
8. Closing `기타 유의사항` section whose wording is near-verbatim shared
   (제출된 서류는 반환하지 않으며… / 본 공고문은 사정에 의하여 변경될 수 있으며…).
9. Body Latin font paired with 휴먼명조 is always **HCI Poppy**.

### The numbered-section subfamily (6-1, 6-2, file 1, file 3)
- Numbered section bars `1. … 9. …` built from the **identical** 2-row table with the
  **#47b0bb → #d0eaed linear gradient, shear 90, blur 50** strip and HY헤드라인M 15pt title.
  Identical in all four — different BorderFill ids, same values.
- Same 안내박스 fill **#fbfaf7**.
- Section name sequence varies:
  - 6-1: 모집개요 / 지원절차 / 사업목적 / 사업기간 / 신청자격 / 신청방법 / 선정절차 / 지원내용 / 기타 유의사항 (9)
  - 6-2: 사업개요 / 추진절차 / 사업목적 / 신청자격 / 지원내용 / 신청방법 / 선정절차 / 기타 유의사항 (8)
  - file 1: 사업개요 / 추진절차 / 참가기업 모집 / 신청방법 (4)
  - file 3: 사업개요 / 추진절차 / 주요 공지사항 / 신청자격 / 신청방법 / 선정절차 / 기타 유의사항 (7)

### What differs
| | 6-1 | 6-2 | file 1 외식서비스 | file 2 실라리안 | file 3 PRIDE |
|---|---|---|---|---|---|
| body Hangul font | 휴먼명조 13pt | 휴먼명조 13pt | **HY중고딕 13pt** | **휴먼명조 14pt** | 휴먼명조 13pt |
| body line spacing | 160% | 160–180% | **190%** | 140–180% | 180% |
| section bars | 9, gradient | 8, gradient | 4, gradient | **none** | 7, gradient |
| 안내박스 fill | #fbfaf7 | #fbfaf7 | #fbfaf7 | **#ffe7d8** | #fbfaf7 |
| 안내박스 heading font | 한양중고딕 15pt B | 한양중고딕 15pt B | HY중고딕 15pt B | **한컴 소망 M 15pt** | 한양중고딕 15pt B |
| 2단계 bullet glyph | `ㅇ` / `○` | `ㅇ` | `ㅇ` | **`❍`** | `ㅇ` |
| top/bottom margin | 12.7mm | 12.7mm | 12.7mm | **10.0mm** | 12.7mm |
| section header style | gradient bar | gradient bar | gradient bar | **1×3 table band** | gradient bar |
| special | 별첨1 정량평가표 (#3a3c84) | 제출서류 14×4 | 󰊱󰊲󰊳󰊴 circled-number heads, `(필독) 유의사항` in 휴먼둥근헤드라인 16pt | `붙임 … 끝.` 공문 closing; 15×7 정성평가표 | ①~⑦ 지원제외 list; `붙임 … 끝.` |

File 2 (실라리안) is the outlier: it drops numbered sections entirely, uses 1-row×3-col shaded
bands as section headers, sets body text at 휴먼명조 14pt, and closes with the formal
공문 pattern `붙임  참가신청서(양식) 1부.  끝.`

## 10. 신청서 서식 (6-4) STRUCTURE
Page margins 20mm L/R, 15mm T/B. Font system is different from the 공고문 body: **맑은 고딕**
for the main application tables, **HY중고딕** for the 사업계획서, **함초롬바탕** for the
수출직불금 신청서 and 서약서, **푸른전남** for the last 개인정보 동의서.

Form sequence (each block is a full-width 1-col or multi-col table, 167–170mm):
1. **기업정보** 12×5 (169.1mm) — 기업명 / 사업자등록번호(법인등록번호) / 대표자명 /
   대표자 생년월일 / 설립일자 / 본사(주소,☎,Fax) / 공장(주소) / 업종(표준산업분류) /
   기업현황 매출액('25년) / 인력기준 상시종업원수 / 주력제품 / 주요고객사.
   Section heading cell 맑은 고딕 14pt bold, labels 10pt centered.
2. **사업신청 내용** 13×4 (168.9mm) — 매뉴얼사업 / 소요금액(원)※부가세 제외 /
   신청금액 / 업체자부담 / 합계, + 2 ※ notes.
3. **담당자 연락처** 5×4 — 성명/소속부서/직위/회사전화/휴대전화/FAX/E-Mail.
4. **신청 선언 1×1** — `상기 신청 법인은 관련 법령을 준수하면서 『{{사업명}}』 참여하고자
   신청서를 제출합니다.` + `2026년   월   일` + `기업명 : (인)` +
   **`안동시장·경상북도경제진흥원장 귀하`** (맑은 고딕 16pt bold, right).
5. **사업계획서** 9×2 (167.9mm), HY중고딕 12pt — 지원사업명(매뉴얼항목) / 1.필요성 /
   2.신청내용(신청내용·추진전략·추진절차) / 3.최종목표 (+2×3 목표표) / 4.추진일정 (+5×31 간트) /
   5.예산 집행계획 (+5×4) / 6.사업관리 전담인력 (+5×5) / 7.기대효과 및 성과활용 (+2×2).
   Each numbered heading is bold with a `※` guidance clause appended.
6. **개인정보의 수집·이용·제공·활용에 관한 동의서** 1×1, 휴먼명조 — 목적 / 수집‧조회 및 활용 정보
   (①이력정보 ②과세정보 ③개인정보) / 수집‧조회 및 활용 기관 / 보유 및 이용기간 /
   개인정보처리의 위탁 / 개인정보 제3자 제공, each followed by a
   `개인정보 수집ㆍ이용에 동의합니까 │ □동의함 │ □동의하지 않음` 1×3 table (HY강M 12pt bold).
7. **지원요건 준수 확인서** 1×1, 휴먼명조 — 목적 + 제외요건 nested 1×1 holding ①~⑬ list (10pt).
8. **수출직불금 기업현황 신청서** 17×7 (168.0mm), 함초롬바탕 — 신청회차 / 기업명(수출화주) /
   사업자번호 / 대표자 / 업종구분 / 주생산품 / 종업원 수 / 소재지(본사,공장) / 담당자 /
   전년도 총수출액·매출액 / 주요 수출품목 / 수출신고필증 block / 입금처.
9. **신청정보** 6×6 + **수출신고 내역** 9×11 tables (맑은 고딕 10–11pt).
10. **지원가능 기업 조건 체크표** 7×4 — 구분 / 지원가능 기업 조건 / 충족 □ / 미충족 □.
11. **서약서** — `- 다    음 -` + 10 numbered clauses (함초롬바탕 12pt) +
    `안동시장·경상북도경제진흥원장 귀중` 16pt bold right.
12. **개인·기업 정보 수집·이용 및 제3자 제공 동의서** — 푸른전남 12pt, two consent tables.

Recurring closing line across all sub-forms: **`안동시장·경상북도경제진흥원장 귀하/귀중`**,
맑은 고딕 or 함초롬바탕 **16.0pt bold, right-aligned**.

## 11. REGENERATION CHECKLIST
- [ ] PageDef 59528×84188, offsets L/R 5669, T/B 3600, header/footer 2834
- [ ] Text column exactly 48190 HWPUNIT on every full-width table
- [ ] Section bar: 2×1 table, r0 h=2848 no-fill/no-border + ps2/HY헤드라인M 15pt;
      r1 h=0 with linear gradient #47b0bb→#d0eaed shear 90 blur 50
- [ ] 안내박스: 1×1 47624 wide, cell fill #fbfaf7, dotted 0.12mm #000000 all sides,
      padding l/r 510 t/b 141, inline=0 flow=block, margins 283
- [ ] Bullet ladder as literal leading spaces, margin-left 0, ps4 (both / 160% ratio / indent 0)
- [ ] 모집개요표: label cols fill #e7f4f6, value col no fill, l/r borders none,
      #47b0bb 0.4mm top rule on r0 and bottom rule on r7/r10, spacer row h=1865
- [ ] 제출서류표/지원내용표 header fill #dfe6f7 with 0.4–0.5mm top rule
- [ ] 정량평가표 borders #3a3c84, header #d9d9d9, nested score tables #cccccc inner
- [ ] BIN0001 logo inline left 26154×3762; BIN0002 chevrons 6900×6900 in arrow cells
- [ ] Page breaks before the logo and before [별첨1]
- [ ] Preserve boilerplate verbatim incl. the `기업게좌` typo
- [ ] Emit hyperlink fields, not bare text: `홈페이지(www.gepa.kr)` is a `FieldHyperLink`
      (`command="http\://www.gepa.kr;1;0;0;"`) wrapping the visible run
- [ ] 합계 cells in the 정량평가표 are `FieldFormula` (`=SUM(?2:?6)??%g;;100` rendering `100`),
      not literal text

## 12. FIELD CONTROLS (easy to lose — parser must descend into them)
`Text` runs can sit one level below `LineSeg` inside a field wrapper. Two kinds occur:
- **FieldHyperLink** (`chid="%hlk"`) — wraps the visible link text.
  - 6-1, 6-2: `command="http\://www.gepa.kr;1;0;0;"` → text `www.gepa.kr`
  - file 1: `mailto:zihyeon@gepa.kr` → text `zihyeon@gepa.kr`
  - file 3: `mailto:lhwokok@gepa.kr` and `https\://total.comwel.or.kr/`
- **FieldFormula** (`chid="%fmu"`) — table 합계 cells.
  - 6-1 `=SUM(?2:?6)??%g;;100` → `100`; file 1 `=SUM(?2:?5)??%g,;;100`;
    file 2 `=SUM(?2:?10)??%g,;;30`; file 3 `=SUM(ABOVE)??%g,;;110`

A parser that only reads `LineSeg/Text` silently drops all of the above and yields `홈페이지()`,
`이메일 접수()`, and empty 합계 cells. Verified fixed: concatenated walk text now contains every
`hwp5txt` line for all six files (0 missing).

### Real contact details recovered
| file | email | phone | web |
|---|---|---|---|
| 6-1, 6-2 | gepa_north@naver.com | 054-900-3801 (북부지소) | www.gepa.kr |
| file 1 | zihyeon@gepa.kr | 054-995-9934 / 1800-8730 | — |
| file 2 | sillarian1997@naver.com | 053-243-8581 | — |
| file 3 | lhwokok@gepa.kr | 054-470-8565 (ESG·기업지원팀) | total.comwel.or.kr |
