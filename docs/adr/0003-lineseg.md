# ADR 0003 — `hp:linesegarray` is omitted from generated paragraphs

**Date:** 2026-09-15 · **Status:** accepted

## Context
Hancom writes one `hp:lineseg` per laid-out line inside every paragraph. The values are a
layout cache (vertical position, line height, width). Our writer cannot know line breaks.

## Options tested (M1, notice smoke document)
1. **Approximate**: one placeholder lineseg per paragraph (what rhwp's own `scaffold` does).
   rhwp's renderer *trusts* it: multi-line paragraphs were squeezed onto one line inside
   table cells and the page count was inflated (7 pages instead of 4).
2. **Omit** the element entirely: rhwp re-lays out from scratch (correct wrapping, hanging
   indents honoured, 4 pages) and **Hancom Office HWP (macOS) opens the file without any
   repair dialog** (status bar 1/4쪽, 1294글자; logo, gradient section bar, overview table
   all rendered as designed — verified by screenshot on 2026-09-15).
3. Round-trip through `@rhwp/core.exportHwpx()` — still emits a single lineseg per paragraph,
   so it does not help.

## Decision
`buildHwpx()` defaults to `lineseg: "omit"`. `lineseg: "approx"` remains available as a switch
(`BuildOptions.lineseg`) if a future Hancom version rejects the omission.
