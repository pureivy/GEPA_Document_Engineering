import { describe, it, expect } from "vitest";
import { readPhotoTaken, takenLabel } from "../../lib/closeout/exif";

/** 작은 끝 TIFF — IFD0 에 Exif 포인터, Exif IFD 에 DateTimeOriginal 만 둔 JPEG 머리 */
function jpegWithExif(dt: string, littleEndian = true): Uint8Array {
  const t: number[] = [];
  const u16 = (v: number) => (littleEndian ? t.push(v & 0xff, v >> 8) : t.push(v >> 8, v & 0xff));
  const u32 = (v: number) => (littleEndian ? t.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, v >>> 24) : t.push(v >>> 24, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff));
  t.push(...(littleEndian ? [0x49, 0x49] : [0x4d, 0x4d])); u16(42); u32(8);
  u16(1); u16(0x8769); u16(4); u32(1); u32(26); u32(0); // IFD0 (8~25) → Exif IFD 는 26
  u16(1); u16(0x9003); u16(2); u32(dt.length + 1); u32(44); u32(0); // Exif IFD (26~43) → 값은 44
  t.push(...[...dt].map((c) => c.charCodeAt(0)), 0);
  const app1 = [...[..."Exif"].map((c) => c.charCodeAt(0)), 0, 0, ...t];
  const len = app1.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...app1, 0xff, 0xda, 0, 2]);
}

describe("readPhotoTaken — 사진 촬영일(EXIF)", () => {
  it("DateTimeOriginal 을 읽는다(작은 끝·큰 끝)", () => {
    expect(readPhotoTaken(jpegWithExif("2025:10:25 14:03:22"))).toEqual({ date: "2025-10-25", time: "14:03" });
    expect(readPhotoTaken(jpegWithExif("2025:06:18 09:30:00", false))).toEqual({ date: "2025-06-18", time: "09:30" });
  });
  it("EXIF 가 없는 사진·JPEG 가 아닌 파일은 undefined", () => {
    expect(readPhotoTaken(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]))).toBeUndefined();
    expect(readPhotoTaken(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeUndefined();
    expect(readPhotoTaken(jpegWithExif("0000:00:00 00:00:00"))).toBeUndefined();
  });
  it("요일을 붙여 적는다", () => {
    expect(takenLabel({ date: "2025-10-25", time: "14:03" })).toBe("2025. 10. 25.(토) 14:03");
  });
});
