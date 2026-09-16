# HWPX generation + web editing: research findings and recommended plan

> **UPDATE: all pending tests have now been EXECUTED.** See "Section 8: test results"
> at the bottom. Two corrections to the body: the OWPML namespaces below are wrong for
> real files (see 8.5), and hwp→hwpx fidelity is document-dependent (see 8.2).

Research done under plan mode. Two scratchpad writes were made after the plan-mode notice
arrived: copying one reference .hwp into the scratchpad and running `hwp5html` on it.
Everything else was read-only. No project files touched. Items marked **PENDING TEST**
require the lead to run one command; they are the only claims not backed by evidence
gathered here.

## 1. Environment facts established

| Fact | Evidence |
|---|---|
| Reference files are HWP 5.x (CFB/OLE2), not HWP 97 | `file` says "Hangul (Korean) Word Processor File 5.x"; magic `d0cf11e0a1b11ae1` |
| LibreOffice 26.2.3.2 has exactly one HWP filter | registry extraction, node `writer_MIZI_Hwp_97` |
| That filter is IMPORT-only and targets HWP 97 | `Flags = IMPORT ALIEN 3RDPARTYFILTER EXOTIC`; no EXPORT flag; no hwpx type node anywhere in `writer.xcd`/`main.xcd` |
| soffice cannot load the reference file | `soffice --headless --convert-to ... ref1.hwp` → `Error: source file could not be loaded` |
| Hancom Office HWP.app has no macOS automation | no `.sdef` in bundle; no `NSAppleScriptEnabled` in Info.plist; `Contents/MacOS/` holds one GUI binary only |
| No Java runtime installed | `java -version` → "Unable to locate a Java Runtime" |
| pyhwp works on the reference file | `hwp5proc ls` listed streams; `hwp5html` produced index.xhtml + styles.css |

Conclusions: **LibreOffice is out in both directions** (no hwpx at all, no HWP 5.x import,
no export). **Hancom GUI cannot be scripted on macOS**; `pyhwpx` is Windows COM only and
is off the table. pyhwp is read-only extraction, useful for mining reference content but
it cannot write.

## 2. Library landscape (verified via GitHub API, not README claims)

| Repo | Stars | License | Last push | Language | Role |
|---|---|---|---|---|---|
| edwardkim/rhwp | 3807 | MIT | 2026-09-14 | Rust | read+write hwp/hwpx/hml, SVG/PDF render, WASM, web editor |
| neolord0/hwplib | 589 | Apache-2.0 | 2026-09-11 | Java | HWP 5.x read/write |
| neolord0/hwpxlib | 183 | Apache-2.0 | 2026-08-31 | Java | HWPX read/write |
| neolord0/hwp2hwpx | 61 | Apache-2.0 | 2026-08-31 | Java | hwp → hwpx |
| airmang/python-hwpx | 109 | Apache-2.0 | 2026-09-13 | Python | hwpx authoring, template fill, validation CLI |
| hahnlee/hwp.js | 1305 | Apache-2.0 | 2025-01-10 | TypeScript | .hwp viewer only, stale, no hwpx |
| shyang1012/hwp-convert | 1 | MIT | 2026-08-22 | TypeScript | claims Hancom-openable hwpx; unvetted |
| ssabro/hwpxjs | 9 | MIT | 2026-04-28 | TypeScript | same dependency set as hwp-convert |

`hwp-convert` and `@ssabrojs/hwpxjs` ship byte-identical dependency sets and identical
exports shape. Treat as one unvetted codebase. Do not build on either.

## 3. Recommended architecture

**Template-preserving, not author-from-scratch.** Keep a reference `Contents/header.xml`
verbatim and regenerate only `Contents/section0.xml`, referencing existing style ids via
`paraPrIDRef` / `charPrIDRef` / `styleIDRef`. This is what makes fonts, spacing and table
borders reproduce faithfully, and it removes most of the OWPML surface from scope.

Pipeline:

1. **Skeleton acquisition (one-time, per template family).** Convert each reference .hwp
   to .hwpx with the `rhwp` CLI. Command verified in the repo's own routing table:
   `rhwp export-hwpx <doc> out/<stem>.hwpx --verify`, documented as accepting HWP5 and
   HWP3 input, with `--verify` re-parsing the output as a gate. A prebuilt
   `rhwp-v0.8.6-macos-aarch64.tar.gz` release asset exists, so no Rust toolchain is
   needed. Fallback if fidelity disappoints: `hwp2hwpx` after
   `brew install --cask temurin`, whose API is
   `HWPReader.fromFile` › `Hwp2Hwpx.toHWPX` › `HWPXWriter.toFilepath`, and whose recent
   commits are HWP-5.x fidelity fixes (surrogate pairs, substitute fonts, cell background,
   divider line styles). Last resort: open in Hancom GUI and Save As .hwpx.
2. **Template curation.** Unzip the .hwpx, keep `mimetype`, `version.xml`, `settings.xml`,
   `Contents/content.hpf`, `Contents/header.xml`, `META-INF/*`, `BinData/*`. Catalogue the
   `charPr` / `paraPr` / `borderFill` / `style` ids so generation references them by id.
3. **Generation service.** Python `python-hwpx` (Apache-2.0, pure Python + lxml) opens the
   template, fills content, and saves in `patch` mode with a preservation report. Its
   `fill_by_path` + `save_to_path(mode="patch", return_report=True)` is exactly the
   byte-preserving path this needs.
4. **Web layer (Next.js).** See section 3b.

### 3b. Web rendering and editing: options compared

The distinguishing requirement is the live "실제 한글 작업이 되는 과정" animation. That
needs frame-level control over what appears on screen, which decides the choice.

| Option | Editing | Animation control | Verdict |
|---|---|---|---|
| hwp.js (hahnlee) | none, viewer only | n/a | **Disqualified.** `.hwp` only, no hwpx, last push 2025-01-10 |
| `@rhwp/editor` | full editor, 30+ hwpctl actions | poor: iframe black box | Good for a real user-facing editor, wrong for a scripted animation |
| `@rhwp/core` WASM | none, `renderPageSvg(n)` | n/a, but pixel-accurate | **Use as the fidelity preview pane** |
| Own ProseMirror/TipTap over a JSON model | full, ours | total, per keystroke | **Use as the animation and authoring surface** |
| hwpx → HTML converters | n/a | n/a | Only useful for read-only extraction |

**Recommendation: split the two jobs.** Drive the typing animation in our own
TipTap/ProseMirror editor over the JSON intermediate model, where we control every frame.
Serialize that JSON to hwpx server-side with `python-hwpx` against the curated template.
Render the resulting hwpx to SVG with `@rhwp/core` in a side-by-side "this is the real
file" pane. Reach for `@rhwp/editor` only if the product later needs genuine end-user
document editing, and accept that its iframe boundary means driving it through hwpctl
actions rather than direct DOM control.

Hancom does sell an official HWP SDK covering both .hwp and .hwpx with roughly 1,000
functions, documented at developer.hancom.com and documents.sdk.hancom.com/hwp/api. It is
commercial and licensed, so treat it as the paid escape hatch, not the default.

## 4. HWPX package structure (for the writer)

```
mimetype                      (first entry, stored uncompressed)
version.xml
settings.xml
Contents/content.hpf          OPF: metadata + manifest + spine
Contents/header.xml           all shape/style definitions
Contents/section0.xml ...     body, one file per section
META-INF/manifest.xml         encryption info
META-INF/container.xml, container.rdf
BinData/, Scripts/, Preview/
```

Namespaces: `hh` = `http://www.owpml.org/owpml/2021/head`,
`hp` = `http://www.owpml.org/owpml/2021/paragraph`.

header.xml: `hh:head[@version,@secCnt]` › `hh:refList` › `hh:fontfaces` ›
`hh:fontface[@lang]` › `hh:font[@id,@face,@type,@isEmbedded]`; `hh:charProperties` ›
`hh:charPr[@id,@textColor]` › `hh:fontRef`; `hh:paraProperties` › `hh:paraPr[@id]` ›
`hh:align[@horizontal,@vertical]`; plus `hh:borderFills`, `hh:styles`, `hh:numberings`.

section0.xml: `hp:sec` › `hp:p[@id,@paraPrIDRef,@styleIDRef,@pageBreak,@columnBreak]` ›
`hp:run[@charPrIDRef]` › `hp:t` (mixed content) | `hp:tbl` › `hp:tr` › `hp:tc` | `hp:pic`
| `hp:ctrl` | `hp:secPr` › `hp:pagePr`.

## 5. Validation without the Hancom GUI

LibreOffice cannot open hwpx, so it is not a validator. Use, in order:

1. `python-hwpx` package-structure validation CLI and its save-time mutation report.
2. `rhwp export-hwpx ... --verify`, which re-parses its own output as a gate.
3. Structural diff of generated zip against the genuine skeleton: entry order, `mimetype`
   stored-first, manifest completeness, spine ids.
4. `xmllint --noout` for well-formedness on every XML part. Note that true **schema**
   validation is not freely available: the KS X 6101 OWPML spec sits behind the KSSN
   paywall and no public XSD was found. The practical substitute is round-tripping through
   `hwpxlib`, whose class model is schema-derived, and treating a clean parse as the check.
5. `rhwp export-pdf` / `export-svg` for a visual render check against the original.
6. One manual open in Hancom Office. **This is the only ground truth for "opens cleanly."**

## 6. PENDING TESTS for the lead

Nothing below has been executed. The command names and APIs are verified from primary
sources; what is unverified is the *fidelity* of the output on these specific documents.

```bash
# 1. hwp -> hwpx, no Java. Prebuilt macOS arm64 binary.
curl -LO https://github.com/edwardkim/rhwp/releases/download/v0.8.6/rhwp-v0.8.6-macos-aarch64.tar.gz
tar xzf rhwp-v0.8.6-macos-aarch64.tar.gz
./rhwp export-hwpx "<ref>.hwp" out/ref.hwpx --verify
unzip -l out/ref.hwpx     # expect mimetype, Contents/header.xml, Contents/section0.xml

# 2. Java fallback, only if step 1 loses fidelity
brew install --cask temurin && java -version

# 3. Authoring round trip. MUST use Python 3.10+, NOT the 3.9 user site
#    where pyhwp lives. Use the brew 3.14 interpreter.
python3.14 -m pip install python-hwpx
python3.14 -c "from hwpx import HwpxDocument; d=HwpxDocument.open('out/ref.hwpx'); print(d)"

# 4. Visual diff of the converted file against the original
./rhwp export-pdf out/ref.hwpx -o out/ref.pdf
```

Acceptance for step 1 is not "a file appeared." It is: page count matches the original,
`Contents/header.xml` carries the original `hh:fontface` entries rather than substituted
fonts, and table borders survive. Check those before building on the skeleton.

## 7. Rejected options and why

- **LibreOffice headless** — no hwpx filter, no HWP 5.x import, no export.
- **Hancom AppleScript / CLI** — does not exist on macOS.
- **pyhwpx** — Windows COM only.
- **hwp.js** — .hwp viewer only, no hwpx, last pushed January 2025.
- **hwp-convert / @ssabrojs/hwpxjs** — 1 and 9 stars, duplicate codebase, unvetted claims.
- **Hand-rolled TypeScript OWPML writer from scratch** — large surface, and unnecessary
  once the template-preserving approach keeps header.xml verbatim.

---

# Section 8: test results (executed)

All work in the session scratchpad. Desktop originals copied, never modified.
rhwp v0.8.6, prebuilt `rhwp-v0.8.6-macos-aarch64.tar.gz`, ran with no Rust toolchain.

## 8.1 Notice document: perfect conversion

`rhwp export-hwpx in/notice.hwp out/notice.hwpx --verify` → **exit 0**,
`검증 통과(--verify): IR 차이 없음`.

| Metric | notice.hwp | notice.hwpx |
|---|---|---|
| Pages | 7 | 7 |
| Paragraphs | 141 | 141 |
| ParaShape / paraPr | 88 | 88 |
| CharShape / charPr | 128 | 128 |
| Styles | 19 | 19 |
| Korean fonts | 10, 굴림…태-물방울R | identical |
| BinData | png 17148 + jpg 936 | identical, original formats |

`render-diff` → `status: PASS`, max displacement **0.00 px**.
PDFs rendered from the .hwp and from the .hwpx are **byte-identical**:
`0bb4ba359dc2ed705da0c884d3d883d6bc8d1a589b9160852975865d04fa3f8a`.

## 8.2 Plan document: lossy, do not ship unchecked

`export-hwpx ... --verify` → **exit 3**, 490 IR differences, every one a `linesegs`
(cached line-layout segment) entry. Metadata is nonetheless perfect: 14/14 pages,
204/204 paragraphs, 100/100 paraPr, 163/163 charPr, 26/26 styles, all 4 BinData
(bmp/png/png/jpg) preserved.

But geometry is not: `render-diff in/plan.hwp out/plan.hwpx` →

```
페이지 수: A=14 B=14
최대 변위: 282.00 px (page 4)
임계 초과 페이지: 9 / 구조 불일치 페이지: 3 (임계 1.00px)
status: STRUCT_MISMATCH
```

The distinguishing feature: plan.hwp contains grouped shapes (묶음 도형, two of them
with nested picture + rectangle children). notice.hwp has none. **Treat grouped shapes
as the known fidelity risk** and gate every converted template on `--verify` plus
`render-diff`.

## 8.3 @rhwp/core writes HWPX from Node — verified

Installed `@rhwp/core@0.8.6` (9.9 MB wasm) and ran a real round trip under Node 22:

```
core version: 0.8.6
LOAD OK. pageCount= 7
para[0] text: "(재)경상북도경제진흥원 공고 제2026070000호"
insertText -> {"ok":true,"charOffset":8}
exportHwpx bytes = 49116
hasBytes= true contentLoss= {"schemaVersion":1,"outputFormat":"hwpx","count":0,"losses":[]}
renderPageSvg(0) length = 249776
```

The exported file reads back cleanly through the CLI: 7 pages, all fonts intact, and
the injected `[EDITED]` marker present in `export-text`. **Content loss: zero.**

Key typings (`node_modules/@rhwp/core/rhwp.d.ts`):

```ts
export class HwpDocument {
  constructor(data: Uint8Array);
  pageCount(): number;
  getTextRange(section_idx: number, para_idx: number, char_offset: number, count: number): string;
  insertText(section_idx: number, para_idx: number, char_offset: number, text: string): string;
  replaceText(sec: number, para: number, char_offset: number, length: number, new_text: string): string;
  insertTextInCell(section_idx: number, parent_para_idx: number, control_idx: number,
                   cell_idx: number, cell_para_idx: number, char_offset: number, text: string): string;
  getTextInCell(...): string;
  exportHwpx(): Uint8Array;
  exportHwpxWithReport(): DocumentExport;   // .contentLoss() / .takeBytes()
  exportHwp(): Uint8Array;
  renderPageSvg(page_num: number): string;
}
export class DocumentExport { contentLoss(): string; hasBytes(): boolean; takeBytes(): Uint8Array; }
```

Init requires passing the wasm explicitly in Node:
`await init({ module_or_path: fs.readFileSync('node_modules/@rhwp/core/rhwp_bg.wasm') })`.

## 8.4 @rhwp/editor: capable, but it phones home

`RhwpEditor` has everything asked for:

```ts
loadFile(data: ArrayBuffer | Uint8Array, fileName?: string, options?: LoadFileOptions): Promise<LoadResult>;
exportHwpx(): Promise<Uint8Array>;
applyTextCommand(command: RhwpApplyTextCommandV1): Promise<RhwpTextCommandReceiptV1>;
revertTextCommand(command: RhwpRevertTextCommandV1): Promise<RhwpTextCommandReceiptV1>;
onDocumentChanged(listener: (event: RhwpDocumentChangedEventV1) => void): () => void;
getSelectionContext(): Promise<RhwpSelectionContextV1>;
focusTarget(target: RhwpBodyParagraphTargetV1): Promise<{ focused: boolean; page: number }>;
getPageSvg(page?: number): Promise<string>;
```

**Blocker:** `index.js` line 25 is
`const DEFAULT_STUDIO_URL = 'https://edwardkim.github.io/rhwp/';` and the component
loads that URL into an iframe, talking to it over postMessage. Shipping this as-is
sends user documents into a third-party GitHub Pages origin. Self-hosting rhwp-studio
and setting `studioUrl` is mandatory before any real use.

## 8.5 CORRECTION: namespaces

The Hancom tech blog describes `http://www.owpml.org/owpml/2021/...`. **Real files do not
use those.** Verified from the generated package:

```
hh = http://www.hancom.co.kr/hwpml/2011/head
hp = http://www.hancom.co.kr/hwpml/2011/paragraph
hs = http://www.hancom.co.kr/hwpml/2011/section
hc = http://www.hancom.co.kr/hwpml/2011/core
ha = http://www.hancom.co.kr/hwpml/2011/app
hm = http://www.hancom.co.kr/hwpml/2011/master-page
hpf = http://www.hancom.co.kr/schema/2011/hpf
hp10 = http://www.hancom.co.kr/hwpml/2016/paragraph
opf = http://www.idpf.org/2007/opf/
```

`mimetype` content is `application/hwp+zip`. Section root is `hs:sec`, not `hp:sec`.

## 8.6 Actual package layout produced

```
mimetype                          application/hwp+zip
version.xml                       hv:HCFVersion, xmlVersion="1.5"
Contents/header.xml               265165 bytes (notice)
Contents/section0.xml             285286 bytes
Contents/content.hpf              OPF manifest + spine
settings.xml
Preview/PrvText.txt               2 bytes   <-- STUB
Preview/PrvImage.png              68 bytes  <-- STUB
META-INF/container.xml, container.rdf, manifest.xml
META-INF/rhwp-hwp5-origin         1 byte    <-- non-standard rhwp marker
BinData/image1.png, image2.jpg
```

Two cleanup items for production output: the Preview parts are stubs, so Windows
Explorer and Hancom file dialogs lose the thumbnail; and `META-INF/rhwp-hwp5-origin`
is a rhwp-specific file that should be stripped.

## 8.7 Real section0.xml markup

```xml
<hp:p id="0" paraPrIDRef="18" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
  <hp:run charPrIDRef="124">
    <hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" ...>
      <hp:pagePr landscape="WIDELY" width="59528" height="84188" gutterType="LEFT_ONLY">
        <hp:margin header="2834" footer="2834" gutter="0"
                   left="5669" right="5669" top="3600" bottom="3600"/>
      </hp:pagePr>
      <hp:pageBorderFill type="BOTH" borderFillIDRef="12" .../>
    </hp:secPr>
    <hp:ctrl><hp:colPr id="" type="NEWSPAPER" layout="LEFT" colCount="1" .../></hp:ctrl>
  </hp:run>
  <hp:run charPrIDRef="124">
    <hp:ctrl><hp:pageNum pos="BOTTOM_CENTER" formatType="DIGIT" sideChar="-"/></hp:ctrl>
    <hp:t>(재)경상북도경제진흥원 공고 제2026070000호</hp:t>
  </hp:run>
  <hp:linesegarray>
    <hp:lineseg textpos="0" vertpos="0" vertsize="1400" textheight="1400"
                baseline="1190" spacing="352" horzpos="0" horzsize="48188" flags="393216"/>
  </hp:linesegarray>
</hp:p>
```

Element counts in notice.hwpx: header.xml has 7 `hh:fontface`, 71 `hh:font`,
128 `hh:charPr`, 88 `hh:paraPr`, 57 `hh:borderFill`, 19 `hh:style`, 1 `hh:numbering`,
6 `hh:tabPr`. section0.xml has 415 `hp:p`, 512 `hp:run`, 493 `hp:t`, 20 `hp:tbl`,
75 `hp:tr`, 233 `hp:tc`, 3 `hp:pic`, 1 `hp:secPr`, 415 `hp:linesegarray`.

## 8.8 rhwp scaffold: generates HWPX from JSON, but too plain

Schema discovered by probing the parser's error messages. Required top-level fields:
`version` (must be the **string** `"1"`), `title`, optional `font`, `page_size`, and
`blocks`. Each block is `{type, level?, text?, rows?}` with type
`heading | paragraph | table`.

It works — produced a valid 1-page hwpx that reads back cleanly. But the output carries
only 3 `hh:charPr`, 1 `hh:style`, 2 `hh:borderFill`, versus 128/19/57 in a real notice.
It also double-numbers headings ("1.1. 사업목적" from input text "1. 사업목적").
**Not a substitute for template preservation.** Useful only for throwaway documents.

## 8.9 Verdict on the stack question

**A single TypeScript stack is viable.** `@rhwp/core` loads, edits and writes HWPX from
Node with zero reported content loss, and renders pages to SVG for preview. python-hwpx
is **not required**.

Keep python-hwpx in reserve for two things it does better: named-style authoring
(`add_paragraph(style="개요 2")`) and label-addressed form filling
(`fill_by_path({"성명 > right": ...})`). rhwp addresses cells positionally by
`(section, para, control, cell, cellPara, offset)`, which is more brittle against
template edits. If templates are stable, stay in TypeScript.

## 8.10 Recommended pipeline, revised

1. Convert each reference .hwp once with `rhwp export-hwpx --verify`.
2. **Gate every template**: require `--verify` exit 0 AND `render-diff` PASS. Notice-type
   documents pass clean. Plan-type documents with grouped shapes do not; fix those by
   hand in Hancom and re-export, or accept the drift knowingly.
3. Store the passing .hwpx as the template. Strip `META-INF/rhwp-hwp5-origin`.
4. In Next.js, load the template with `@rhwp/core` server-side, apply edits, call
   `exportHwpxWithReport()`, and **fail the request if `contentLoss.count > 0`**.
5. Preview with `renderPageSvg(n)`. Run the typing animation in our own
   TipTap/ProseMirror surface, not in the rhwp editor.
6. Self-host rhwp-studio before using `@rhwp/editor` at all.
