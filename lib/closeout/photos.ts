/**
 * 사진 자산 — 결과보고서 사진 대지(```photos)가 쓰는 그림 파일.
 *
 *  - `resolveAsset`: 문서의 `src`(프로젝트 작업 폴더 기준 상대 경로)를 실제 파일로 — 폴더 밖·이미지 아닌 파일은 거절
 *  - `imageInfo`: PNG·JPEG 머리에서 픽셀 크기를 읽는다(한글 그림 원본 크기 orgSz = 픽셀 × 75)
 *  - `extractHwpxPhotos`: 공문 hwpx 안의 BinData 사진을 꺼낸다(현장실사·체험 프로그램 결과 보고에 사진이 들어 있다)
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { unzipSync } from "fflate";
import { projectDir } from "../storage/paths";
import { imageInfo } from "../hwpx/imageInfo";

export { imageInfo };

export const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".bmp"] as const;

export function photoMediaType(name: string): string | null {
  const e = path.extname(name).toLowerCase();
  return e === ".png" ? "image/png" : e === ".jpg" || e === ".jpeg" ? "image/jpeg" : e === ".bmp" ? "image/bmp" : null;
}

/** 작업 폴더 기준 경로 → 파일 바이트. `..`·절대 경로·이미지 아닌 확장자는 undefined */
export function resolveAsset(projectId: string, src: string): { bytes: Uint8Array; mediaType: string; name: string } | undefined {
  const rel = src.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel || rel.startsWith("/") || /^[a-z]:/i.test(rel) || rel.split("/").includes("..")) return undefined;
  const mediaType = photoMediaType(rel);
  if (!mediaType) return undefined;
  const root = projectDir(projectId);
  const file = path.resolve(root, rel);
  if (!file.startsWith(path.resolve(root) + path.sep) || !existsSync(file)) return undefined;
  return { bytes: new Uint8Array(readFileSync(file)), mediaType, name: path.basename(file) };
}

/**
 * hwpx 안의 사진(BinData/*.jpg|png) — 로고·도장·아이콘·현수막을 거르려고 짧은 변 300px 이상, 40KB 이상, 가로세로 비 2.5 이하만.
 * 순서는 BinData 이름 순(한글이 본문에 넣은 순서와 대체로 같다).
 */
export function extractHwpxPhotos(bytes: Uint8Array): { name: string; bytes: Uint8Array; width: number; height: number }[] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => /^BinData\/[^/]+\.(jpe?g|png|bmp)$/i.test(f.name) });
  } catch {
    return [];
  }
  const out: { name: string; bytes: Uint8Array; width: number; height: number }[] = [];
  for (const name of Object.keys(files).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const b = files[name];
    const info = imageInfo(b);
    // 현수막·띠 그림(가로세로 2.5배 넘음)은 사진이 아니다
    if (!info || b.byteLength < 40 * 1024 || Math.min(info.width, info.height) < 300 || Math.max(info.width, info.height) / Math.min(info.width, info.height) > 2.5) continue;
    // BMP 는 PNG 로 바꿔 둔다 — 에이전트가 열어 볼 수 있고 한글 파일도 가벼워진다
    const png = info.type === "bmp" ? bmpToPng(b) : undefined;
    out.push(png ? { name: path.basename(name).replace(/\.bmp$/i, ".png"), bytes: png, width: info.width, height: info.height } : { name: path.basename(name), bytes: b, width: info.width, height: info.height });
  }
  return out;
}

/**
 * BMP → PNG. 공문 hwpx 의 현장 사진은 BMP(24비트 무압축)로 들어 있는데, 에이전트(Read)는 BMP 를 열지 못해 사진을
 * 확인하지 못하고 빼 버렸다(2026-10-07). 꺼낼 때 PNG 로 바꿔 둔다. 24·32비트 무압축만 — 그 밖은 undefined(원본 유지).
 */
export function bmpToPng(bmp: Uint8Array): Uint8Array | undefined {
  if (bmp.length < 54 || bmp[0] !== 0x42 || bmp[1] !== 0x4d) return undefined;
  const dv = new DataView(bmp.buffer, bmp.byteOffset, bmp.byteLength);
  const offset = dv.getUint32(10, true);
  const w = dv.getInt32(18, true);
  const hRaw = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  const comp = dv.getUint32(30, true);
  if (w <= 0 || hRaw === 0 || !(bpp === 24 || bpp === 32) || !(comp === 0 || (comp === 3 && bpp === 32))) return undefined;
  const h = Math.abs(hRaw);
  const bottomUp = hRaw > 0;
  const stride = Math.ceil((w * bpp) / 32) * 4;
  if (offset + stride * h > bmp.length) return undefined;
  const px = bpp / 8;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const src = offset + (bottomUp ? h - 1 - y : y) * stride;
    const dst = y * (w * 3 + 1);
    raw[dst] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const s = src + x * px;
      raw[dst + 1 + x * 3] = bmp[s + 2];
      raw[dst + 2 + x * 3] = bmp[s + 1];
      raw[dst + 3 + x * 3] = bmp[s];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 6 })), pngChunk("IEND", Buffer.alloc(0))]));
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  let c = 0xffffffff;
  for (const b of td) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, td, crc]);
}
