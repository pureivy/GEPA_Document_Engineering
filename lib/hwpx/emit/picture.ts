import { clone, el, findAll, type XmlNode } from "../xml";

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

/**
 * 새 그림(사진) — 참고 문서의 <hp:pic>(로고)과 같은 구조로 처음부터 만든다. 글자처럼 취급(treatAsChar)하고
 * 원본 크기(orgSz)는 픽셀 × 75(96 dpi 기준 HWPUNIT), 표시 크기는 width×height 로 줄인다.
 */
/**
 * `crop` — 원본에서 보일 영역(0~1 비율). 사진 대지가 사진 높이를 맞추려고 가운데를 잘라 쓴다(늘이지 않는다).
 */
export function pictureOf(binId: string, px: { width: number; height: number }, size: { width: number; height: number }, ids: { id: number; instid: number; zOrder: number }, crop?: { x: number; y: number; w: number; h: number }): XmlNode {
  const ow = Math.max(1, Math.round(px.width * 75));
  const oh = Math.max(1, Math.round(px.height * 75));
  const w = Math.max(1, Math.round(size.width));
  const h = Math.max(1, Math.round(size.height));
  const c = crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const clip = { left: Math.round(ow * c.x), top: Math.round(oh * c.y), right: Math.round(ow * (c.x + c.w)), bottom: Math.round(oh * (c.y + c.h)) };
  const sx = w / (clip.right - clip.left), sy = h / (clip.bottom - clip.top);
  return el("hp:pic", { id: ids.id, zOrder: ids.zOrder, numberingType: "PICTURE", textWrap: "TOP_AND_BOTTOM", textFlow: "BOTH_SIDES", lock: "0", dropcapstyle: "None", href: "", groupLevel: "0", instid: ids.instid, reverse: "0" }, [
    el("hp:offset", { x: 0, y: 0 }),
    el("hp:orgSz", { width: ow, height: oh }),
    el("hp:curSz", { width: w, height: h }),
    el("hp:flip", { horizontal: 0, vertical: 0 }),
    el("hp:rotationInfo", { angle: 0, centerX: Math.round(w / 2), centerY: Math.round(h / 2), rotateimage: 0 }),
    el("hp:renderingInfo", {}, [
      el("hc:transMatrix", { e1: 1, e2: 0, e3: 0, e4: 0, e5: 1, e6: 0 }),
      el("hc:scaMatrix", { e1: sx.toFixed(6), e2: 0, e3: 0, e4: 0, e5: sy.toFixed(6), e6: 0 }),
      el("hc:rotMatrix", { e1: 1, e2: 0, e3: 0, e4: 0, e5: 1, e6: 0 }),
    ]),
    el("hp:imgRect", {}, [el("hc:pt0", { x: 0, y: 0 }), el("hc:pt1", { x: ow, y: 0 }), el("hc:pt2", { x: ow, y: oh }), el("hc:pt3", { x: 0, y: oh })]),
    el("hp:imgClip", clip),
    el("hp:inMargin", { left: 0, right: 0, top: 0, bottom: 0 }),
    el("hp:imgDim", { dimwidth: ow, dimheight: oh }),
    el("hc:img", { binaryItemIDRef: binId, bright: 0, contrast: 0, effect: "REAL_PIC", alpha: 0 }),
    el("hp:effects"),
    el("hp:sz", { width: w, widthRelTo: "ABSOLUTE", height: h, heightRelTo: "ABSOLUTE", protect: 0 }),
    el("hp:pos", { treatAsChar: 1, affectLSpacing: 0, flowWithText: 1, allowOverlap: 0, holdAnchorAndSO: 0, vertRelTo: "PARA", horzRelTo: "PARA", vertAlign: "TOP", horzAlign: "LEFT", vertOffset: 0, horzOffset: 0 }),
    el("hp:outMargin", { left: 0, right: 0, top: 0, bottom: 0 }),
  ]);
}
