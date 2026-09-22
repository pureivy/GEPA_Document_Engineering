/**
 * Loads a curated template package (templates/<family>/pkg) and exposes the pieces the
 * writer needs: parsed header, section root namespaces, first-paragraph fragments
 * (secPr/colPr/pageNum), reference picture nodes, catalog, role map, binary data.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseXml, findAll, childrenNamed, child, clone, isNode, type XmlNode } from "./xml";
import { parseHeaderCatalog, type HeaderCatalog } from "./header";
import type { Family } from "../docmodel/schema";

export interface RoleMap {
  para: Record<string, { paraPr: number; charPr: number }>;
  borderFill: Record<string, number>;
}

export interface Template {
  family: Family;
  dir: string;
  header: XmlNode; // parsed header.xml (mutable copy is made per build)
  headerXml: string;
  catalog: HeaderCatalog;
  roles: RoleMap;
  secAttrs: Record<string, string>; // xmlns declarations of <hs:sec>
  secPrRun: XmlNode; // <hp:run> containing hp:secPr + colPr ctrl (from reference para 0)
  pageNumCtrl: XmlNode | undefined; // <hp:ctrl><hp:pageNum …/></hp:ctrl>
  pics: Record<string, XmlNode>; // binaryItemIDRef → reference <hp:pic>
  files: Record<string, Uint8Array>; // all non-XML package files (mimetype, BinData, META-INF, settings, version, content.hpf)
}

const TEMPLATE_FAMILY: Record<Family, string> = { notice: "notice", plan: "plan", press: "press", official: "official", report: "report" };
const cache = new Map<string, Template>();

export function templateDir(family: Family): string {
  return join(process.cwd(), "templates", TEMPLATE_FAMILY[family]);
}

export function loadTemplate(family: Family): Template {
  const dir = templateDir(family);
  const cached = cache.get(dir + family);
  if (cached) return cached;
  const pkg = join(dir, "pkg");
  if (!existsSync(pkg)) throw new Error(`template package missing: ${pkg} (run scripts/curate-template.ts)`);
  const headerXml = readFileSync(join(pkg, "Contents/header.xml"), "utf8");
  const header = parseXml(headerXml);
  const section = parseXml(readFileSync(join(pkg, "Contents/section0.xml"), "utf8"));
  const secAttrs = { ...section.attrs };
  const para0 = childrenNamed(section, "hp:p")[0];
  const runs = childrenNamed(para0, "hp:run");
  const secPrRun = runs.find((r) => child(r, "hp:secPr"));
  if (!secPrRun) throw new Error("template section0: paragraph 0 has no hp:secPr run");
  let pageNumCtrl: XmlNode | undefined;
  for (const r of runs) for (const c of r.children) if (isNode(c) && c.name === "hp:ctrl" && child(c, "hp:pageNum")) pageNumCtrl = clone(c);
  const pics: Record<string, XmlNode> = {};
  for (const pic of findAll(section, "hp:pic")) {
    const img = findAll(pic, "hc:img")[0];
    const ref = img?.attrs.binaryItemIDRef;
    if (ref && !pics[ref]) pics[ref] = pic;
  }
  const files: Record<string, Uint8Array> = {};
  const walk = (rel: string) => {
    for (const e of readdirSync(join(pkg, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else if (r !== "Contents/header.xml" && r !== "Contents/section0.xml") files[r] = new Uint8Array(readFileSync(join(pkg, r)));
    }
  };
  walk("");
  const rolesPath = join(dir, "style-map.json");
  const roles: RoleMap = existsSync(rolesPath) ? JSON.parse(readFileSync(rolesPath, "utf8")) : { para: {}, borderFill: {} };
  const t: Template = {
    family,
    dir,
    header,
    headerXml,
    catalog: parseHeaderCatalog(header),
    roles,
    secAttrs,
    secPrRun: clone(secPrRun),
    pageNumCtrl,
    pics,
    files,
  };
  cache.set(dir + family, t);
  return t;
}
