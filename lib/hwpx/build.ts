/** buildHwpx: DocModel → HWPX bytes (template header + generated section0) + report. */
import { zipSync } from "fflate";
import { el, serialize, clone, findAll, findFirst, XML_DECL, type XmlNode } from "./xml";
import { loadTemplate } from "./template";
import { WriterContext } from "./writers/context";
import { writeNotice } from "./writers/notice";
import { writePlan } from "./writers/plan";
import { writePress } from "./writers/press";
import type { DocModel } from "../docmodel/schema";
import type { AppendedStyle } from "./registry";
import type { BuildWarning } from "./writers/context";
import { DOC_FAMILIES } from "../docmodel/families";

export interface BuildReport {
  family: DocModel["family"];
  paragraphs: number;
  tables: number;
  pictures: number;
  appendedStyles: AppendedStyle[];
  warnings: BuildWarning[];
  title: string;
}

export interface BuildResult {
  bytes: Uint8Array;
  report: BuildReport;
  sectionXml: string;
  headerXml: string;
}

export interface BuildOptions {
  now?: Date;
  /** 'omit' (default) leaves layout to the reader; 'approx' writes one placeholder lineseg per paragraph */
  lineseg?: "omit" | "approx";
}

function sec0(paras: XmlNode[]): XmlNode {
  return el("hs:sec", {}, paras);
}

export function buildHwpx(doc: DocModel, opts: BuildOptions = {}): BuildResult {
  const tpl = loadTemplate(doc.family);
  const ctx = new WriterContext(tpl, doc.family, { lineseg: opts.lineseg === "approx" });
  let paras: XmlNode[];
  if (doc.family === "notice") paras = writeNotice(ctx, doc);
  else if (doc.family === "plan") paras = writePlan(ctx, doc);
  else paras = writePress(ctx, doc);
  if (paras.length === 0) paras = [ctx.para({ paraPr: 0, runs: [{ charPr: 0, text: "" }] })];
  // section properties live in the first run of the first paragraph
  const secPrRun = clone(tpl.secPrRun);
  if (doc.family === "plan") {
    // 범정부오피스(범피스) 용지 여백: 위 15 / 아래 10 / 좌·우 20 mm, 머리말·꼬리말 10 mm — 모든 계획서에 적용(user, 2026-09-16)
    const margin = findFirst(secPrRun, "hp:margin");
    if (margin) Object.assign(margin.attrs, { top: "4252", bottom: "2835", left: "5669", right: "5669", header: "2835", footer: "2835" });
  }
  paras[0].children.unshift(secPrRun);
  // page number control (bottom centre, as in every reference) — the notice writer places it
  // in its first run itself; for the other families add it after the secPr run. The plan
  // reference also hides the number on the cover page (hp:pageHiding hidePageNum="1").
  if (tpl.pageNumCtrl && findAll(sec0(paras), "hp:pageNum").length === 0) {
    const charPr = String(secPrRun.attrs.charPrIDRef ?? "0");
    const ctrls: XmlNode[] = [clone(tpl.pageNumCtrl)];
    if (doc.family === "plan") ctrls.push(el("hp:ctrl", {}, [el("hp:pageHiding", { hideHeader: "0", hideFooter: "0", hideMasterPage: "0", hideBorder: "0", hideFill: "0", hidePageNum: "1" })]));
    paras[0].children.splice(1, 0, el("hp:run", { charPrIDRef: charPr }, ctrls));
  }
  const sec = el("hs:sec", tpl.secAttrs, paras);
  const sectionXml = XML_DECL + serialize(sec);
  const headerXml = XML_DECL.replace(" ?>", "?>") + serialize(ctx.reg.header);

  const now = opts.now ?? new Date();
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const title = DOC_FAMILIES[doc.family].docTitle(doc);
  const hpfSrc = new TextDecoder().decode(tpl.files["Contents/content.hpf"]);
  const hpf = hpfSrc
    .replace(/<opf:title\/>|<opf:title>.*?<\/opf:title>/, `<opf:title>${escapeXml(title)}</opf:title>`)
    .replace(/<opf:meta name="creator" content="text">.*?<\/opf:meta>/, `<opf:meta name="creator" content="text">GEPA Document Engineering</opf:meta>`)
    .replace(/<opf:meta name="CreatedDate" content="text"\/>|<opf:meta name="CreatedDate" content="text">.*?<\/opf:meta>/, `<opf:meta name="CreatedDate" content="text">${stamp}</opf:meta>`)
    .replace(/<opf:meta name="ModifiedDate" content="text"\/>|<opf:meta name="ModifiedDate" content="text">.*?<\/opf:meta>/, `<opf:meta name="ModifiedDate" content="text">${stamp}</opf:meta>`);
  const prvText = new TextEncoder().encode(plainTextPreview(doc).slice(0, 1000));

  const enc = (s: string) => new TextEncoder().encode(s);
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    mimetype: [enc("application/hwp+zip"), { level: 0 }],
    "version.xml": [tpl.files["version.xml"], { level: 6 }],
    "Contents/header.xml": [enc(headerXml), { level: 6 }],
    "Contents/section0.xml": [enc(sectionXml), { level: 6 }],
    "Preview/PrvText.txt": [prvText, { level: 6 }],
    "Preview/PrvImage.png": [tpl.files["Preview/PrvImage.png"] ?? new Uint8Array(), { level: 6 }],
    "settings.xml": [tpl.files["settings.xml"], { level: 6 }],
    "META-INF/container.rdf": [tpl.files["META-INF/container.rdf"], { level: 6 }],
  };
  for (const [name, bytes] of Object.entries(tpl.files)) if (name.startsWith("BinData/")) files[name] = [bytes, { level: 6 }];
  files["Contents/content.hpf"] = [enc(hpf), { level: 6 }];
  files["META-INF/container.xml"] = [tpl.files["META-INF/container.xml"], { level: 6 }];
  files["META-INF/manifest.xml"] = [tpl.files["META-INF/manifest.xml"], { level: 6 }];
  for (const k of Object.keys(files)) if (!files[k][0]) throw new Error(`template file missing: ${k}`);
  const bytes = zipSync(files, { mtime: new Date("1980-01-01T00:00:00Z") });

  const report: BuildReport = {
    family: doc.family,
    paragraphs: (sectionXml.match(/<hp:p /g) ?? []).length,
    tables: (sectionXml.match(/<hp:tbl /g) ?? []).length,
    pictures: (sectionXml.match(/<hp:pic /g) ?? []).length,
    appendedStyles: ctx.reg.appended,
    warnings: [...ctx.warnings, ...ctx.reg.warnings.map((w) => ({ message: w }))],
    title,
  };
  return { bytes, report, sectionXml, headerXml };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function plainTextPreview(doc: DocModel): string {
  const lines: string[] = [];
  for (const b of doc.blocks) {
    if (b.k === "para" || b.k === "coverTitle") lines.push(b.inlines.map((i) => (i.t === "br" ? "\n" : i.text)).join(""));
    else if (b.k === "sectionBar") lines.push(`${b.number}. ${b.title}`);
    else if (b.k === "chapterBand") lines.push(`${b.numeral} ${b.title}`);
    else if (b.k === "sectionChip") lines.push(`${b.label} ${b.title}`);
    if (lines.join("\n").length > 1200) break;
  }
  return lines.join("\n");
}
