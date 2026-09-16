# ADR 0004 — Section-scoped controls appear exactly once; cloned fragments are stripped

**Date:** 2026-09-15 · **Status:** accepted

## Context
The plan writer's 결재란 (approval block) is reproduced by cloning two geometry fragments
taken verbatim from the reference 사업계획(안): `t00` (logo picture paragraph) and `t01`
(12×11 approval grid). `t00` is the reference's **first paragraph**, and in HWPX the first
paragraph of a section carries the section-scoped controls:

- `hp:secPr` (page size, margins, footnote settings…),
- `hp:ctrl/hp:colPr` (column layout),
- `hp:ctrl/hp:pageNum` and `hp:ctrl/hp:pageHiding`.

`build.ts` already inserts the template's own `secPr` run at the head of paragraph 0, so a
document that starts with the approval block ended up with **two `hp:secPr` and two
`hp:colPr`**.

## Symptom
`@rhwp/core` validation passed (content loss 0, 13 pages rendered) and every test was green,
but **Hancom Office HWP refused the file**: "파일을 읽거나 저장하는데 오류가 있습니다."
Bisecting the generated document by block kind (`scripts/build-subset.ts`, opening each
subset in Hancom via `open -a` + an AppleScript dialog probe) isolated `approvalBlock`; the
duplicate `hp:secPr` was the cause.

## Decision
1. `cloneFragment()` (lib/hwpx/geometry.ts) now calls `stripSectionControls()`, which removes
   `hp:secPr` and any `hp:ctrl` whose children are all section-scoped controls
   (`colPr`, `pageNum`, `pageHiding`, `header`, `footer`, `footNote`, `endNote`, `newNum`,
   `pageNumCtrl`) from every paragraph of the fragment, then drops runs left empty.
2. `buildHwpx()` inserts the template's page-number control (bottom centre) after the `secPr`
   run when the writer did not place one itself; for the plan family it also adds
   `hp:pageHiding hidePageNum="1"` so the cover page shows no number, as in the reference.
3. `tests/hwpx/build.test.ts` asserts that a built plan carries exactly one `secPr`, `colPr`,
   `pageNum` and `pageHiding`, in that order, and no empty runs.

## Consequences
- rhwp is lenient where Hancom is strict: **rhwp validation is necessary but not sufficient**.
  Every new composite block that clones reference XML must be opened in Hancom once
  (`scripts/build-subset.ts` + `scripts/hancom-check.sh`), and the golden/smoke files for
  all three families were re-checked after this fix (plan 13쪽, notice 7쪽, press 2쪽 open
  cleanly).
- Geometry snapshots are still taken verbatim (no re-curation needed); the stripping happens
  at clone time, so `t00` keeps its original structure on disk for future extraction.
