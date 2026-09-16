import { clone, findAll, type XmlNode } from "../xml";

/**
 * Clone a reference <hp:pic> (logo / chevron) with fresh ids and optional rescale.
 * All geometry attributes (orgSz, imgRect, imgClip, imgDim) are kept from the reference;
 * only curSz/sz/scaMatrix/rotationInfo center change when a new width is requested.
 */
export function pictureFrom(ref: XmlNode, ids: { id: number; instid: number; zOrder: number }, widthHwp?: number): XmlNode {
  const pic = clone(ref);
  pic.attrs.id = String(ids.id);
  pic.attrs.instid = String(ids.instid);
  pic.attrs.zOrder = String(ids.zOrder);
  // drop the Korean "그림입니다" comment; it is metadata only
  pic.children = pic.children.filter((c) => typeof c === "string" || c.name !== "hp:shapeComment");
  if (widthHwp) {
    const org = findAll(pic, "hp:orgSz")[0];
    const cur = findAll(pic, "hp:curSz")[0];
    const sz = findAll(pic, "hp:sz")[0];
    const sca = findAll(pic, "hc:scaMatrix")[0];
    const rot = findAll(pic, "hp:rotationInfo")[0];
    const ow = Number(org?.attrs.width ?? 1), oh = Number(org?.attrs.height ?? 1);
    const scale = widthHwp / ow;
    const h = Math.round(oh * scale);
    for (const n of [cur, sz]) if (n) { n.attrs.width = String(widthHwp); n.attrs.height = String(h); }
    if (sca) { sca.attrs.e1 = String(scale); sca.attrs.e5 = String(scale); }
    if (rot) { rot.attrs.centerX = String(Math.round(widthHwp / 2)); rot.attrs.centerY = String(Math.round(h / 2)); }
  }
  return pic;
}

export function pictureSize(pic: XmlNode): { width: number; height: number } {
  const sz = findAll(pic, "hp:sz")[0];
  return { width: Number(sz?.attrs.width ?? 0), height: Number(sz?.attrs.height ?? 0) };
}
