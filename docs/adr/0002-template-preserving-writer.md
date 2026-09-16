# ADR 0002 — HWPX output is produced by a template-preserving writer

**Date:** 2026-09-15 · **Status:** accepted

We do not author OWPML from scratch and we do not depend on LibreOffice or Hancom automation
(neither can convert or script on macOS). Instead:

1. Each reference `.hwp` is converted once with `bin/rhwp export-hwpx --verify`
   (`scripts/curate-template.ts`). The notice reference converts losslessly; the plan
   reference keeps all styles but its grouped-shape cover title drifts, so only its
   `header.xml` and table geometry are reused.
2. `templates/<family>/pkg/` keeps `header.xml`, `content.hpf`, `version.xml`, `settings.xml`,
   `META-INF/*`, `BinData/*` verbatim. `lib/hwpx/build.ts` regenerates only
   `Contents/section0.xml` from the DocModel.
3. Styles are resolved by *meaning* (`StyleRegistry`): a normalized signature is looked up in
   the template catalog; misses are appended to `header.xml` (cloned from the nearest
   catalogued entry, `itemCnt` maintained). The golden 6-1 document builds with zero appended
   `charPr`; only hanging-indent `paraPr` variants are appended.
4. Indentation is literal leading spaces (as in every reference) plus a hanging indent whose
   size equals the prefix width, so wrapped lines align under the text.
5. Validation: `@rhwp/core` load + `exportHwpxWithReport().contentLoss == 0` + page count +
   SVG render, zip layout (`mimetype` first, stored), XML well-formedness; `rhwp verify` /
   `render-diff` in scripts; a manual Hancom open per milestone (done for M1 on 2026-09-15).
