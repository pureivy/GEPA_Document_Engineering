/** 그림 파일 머리에서 픽셀 크기 읽기 — 사진 대지(lib/hwpx/writers/common.ts emitPhotos)와 자료 사진 목록이 쓴다 */
/** PNG·JPEG 의 픽셀 크기. 읽을 수 없으면 undefined */
export function imageInfo(bytes: Uint8Array): { width: number; height: number; type: "png" | "jpeg" | "bmp" } | undefined {
  // BMP — 공문 hwpx 의 현장 사진이 BMP 로 들어 있다(현장실사·체험 프로그램 결과 보고). 높이는 음수(위→아래)일 수 있다
  if (bytes.length > 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: Math.abs(dv.getInt32(18, true)), height: Math.abs(dv.getInt32(22, true)), type: "bmp" };
  }
  if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20), type: "png" };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      // SOF0..SOF15 (C4 DHT, C8 JPG, CC DAC 제외)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], type: "jpeg" };
      }
      if (marker === 0xd9 || marker === 0xda) break;
      i += 2 + len;
    }
  }
  return undefined;
}

