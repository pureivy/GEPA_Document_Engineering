import { deflateSync } from "node:zlib";
import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { parseDsl } from "@/lib/docmodel/dsl";
import { toDsl } from "@/lib/docmodel/serialize/toDsl";
import { toPm } from "@/lib/docmodel/prosemirror/toPm";
import { fromPm } from "@/lib/docmodel/prosemirror/fromPm";
import { buildHwpx } from "@/lib/hwpx/build";
import { validateHwpx } from "@/lib/hwpx/validate";
import { imageInfo } from "@/lib/hwpx/imageInfo";
import { bmpToPng } from "@/lib/closeout/photos";

/** w×h 단색 PNG — 테스트용 진짜 그림 */
function png(w: number, h: number): Uint8Array {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([60, 120, 200], y * (w * 3 + 1) + 1 + x * 3);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

const DSL = [
  "---",
  "family: plan",
  "제목: 「2025년 시험 사업」 결과보고",
  "부서: ESG·기업지원팀",
  "---",
  "# 추진결과",
  "ㅇ (추진결과) 체험 프로그램 1회 운영",
  "```photos",
  "materials/images/a.png | (체험) 공장 견학",
  "materials/images/b.png | (체험) 장 만들기",
  "materials/images/c.png",
  "```",
  "",
].join("\n");

describe("사진 대지(```photos)", () => {
  it("DSL ↔ DocModel ↔ 편집기 JSON 이 그대로 오간다", () => {
    const { doc } = parseDsl(DSL);
    const ph = doc.blocks.find((b) => b.k === "photos");
    expect(ph && ph.k === "photos" && ph.items).toEqual([
      { src: "materials/images/a.png", caption: "(체험) 공장 견학" },
      { src: "materials/images/b.png", caption: "(체험) 장 만들기" },
      { src: "materials/images/c.png", caption: "" },
    ]);
    expect(parseDsl(toDsl(doc)).doc.blocks.find((b) => b.k === "photos")).toEqual(ph);
    expect(fromPm(toPm(doc)).doc.blocks.find((b) => b.k === "photos")).toEqual(ph);
  });

  it("한글 파일에 사진이 BinData 로 실리고 manifest 에 선언되며, 없는 사진은 경고한다", async () => {
    const { doc } = parseDsl(DSL);
    const imgs: Record<string, Uint8Array> = { "materials/images/a.png": png(400, 300), "materials/images/b.png": png(300, 400) };
    const { bytes, report, sectionXml } = buildHwpx(doc, { assets: (src) => (imgs[src] ? { bytes: imgs[src], mediaType: "image/png" } : undefined) });
    expect(report.pictures).toBeGreaterThanOrEqual(2);
    expect(report.warnings.map((w) => w.message)).toContain("사진을 읽을 수 없습니다: materials/images/c.png");
    const files = unzipSync(bytes);
    const bins = Object.keys(files).filter((f) => /^BinData\/photo\d+\.png$/.test(f));
    expect(bins).toHaveLength(2);
    const hpf = strFromU8(files["Contents/content.hpf"]);
    for (const b of bins) expect(hpf).toContain(`href="${b}"`);
    expect(sectionXml).toContain('binaryItemIDRef="photo');
    expect(sectionXml).toContain("(체험) 공장 견학");
    expect(imageInfo(files[bins[0]])).toEqual({ width: 400, height: 300, type: "png" });
    const v = await validateHwpx(bytes);
    expect(v.errors).toEqual([]);
  }, 60_000);
});

describe("BMP 사진 → PNG", () => {
  it("24비트 무압축 BMP 를 같은 크기의 PNG 로 바꾼다(아래→위 행 순서)", () => {
    const w = 3, h = 2, stride = 12; // 3px × 3B = 9 → 4바이트 정렬 12
    const bmp = new Uint8Array(54 + stride * h);
    const dv = new DataView(bmp.buffer);
    bmp[0] = 0x42; bmp[1] = 0x4d;
    dv.setUint32(2, bmp.length, true); dv.setUint32(10, 54, true); dv.setUint32(14, 40, true);
    dv.setInt32(18, w, true); dv.setInt32(22, h, true); dv.setUint16(26, 1, true); dv.setUint16(28, 24, true);
    const out = bmpToPng(bmp);
    expect(out && imageInfo(out)).toEqual({ width: 3, height: 2, type: "png" });
    expect(imageInfo(bmp)).toEqual({ width: 3, height: 2, type: "bmp" });
  });
});
