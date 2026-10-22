/**
 * 사진의 촬영일 — JPEG 의 EXIF(APP1) 에서 DateTimeOriginal(0x9003), 없으면 DateTime(0x0132)을 읽는다.
 * 사진 대지에 넣을 사진을 세부사업 일정과 맞추는 단서다(교육 4회처럼 비슷한 행사가 여러 번이면 그림만으로는 회차를 모른다).
 * 카카오톡 등으로 주고받아 EXIF 가 지워진 사진·PNG 는 undefined.
 */
export interface PhotoTaken {
  /** 2025-10-25 */
  date: string;
  /** 14:03 */
  time: string;
}

export function readPhotoTaken(bytes: Uint8Array): PhotoTaken | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let p = 2;
  while (p + 4 <= bytes.length && bytes[p] === 0xff) {
    const marker = bytes[p + 1];
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (marker === 0xda || marker === 0xd9) break; // 그림 자료 시작 — EXIF 는 그 앞에 있다
    if (marker === 0xe1 && String.fromCharCode(...bytes.subarray(p + 4, p + 8)) === "Exif") {
      try {
        return fromTiff(bytes.subarray(p + 10, p + 2 + len));
      } catch {
        return undefined;
      }
    }
    p += 2 + len;
  }
  return undefined;
}

function fromTiff(t: Uint8Array): PhotoTaken | undefined {
  const le = t[0] === 0x49; // "II" 작은 끝, "MM" 큰 끝
  const u16 = (o: number) => (le ? t[o] | (t[o + 1] << 8) : (t[o] << 8) | t[o + 1]);
  const u32 = (o: number) => (le ? (t[o] | (t[o + 1] << 8) | (t[o + 2] << 16)) + t[o + 3] * 0x1000000 : t[o] * 0x1000000 + ((t[o + 1] << 16) | (t[o + 2] << 8) | t[o + 3]));
  const ascii = (entry: number) => {
    const n = u32(entry + 4);
    const off = n <= 4 ? entry + 8 : u32(entry + 8);
    return String.fromCharCode(...t.subarray(off, off + n)).replace(/\0+$/, "");
  };
  const tags = (ifd: number) => {
    const m = new Map<number, number>();
    const n = u16(ifd);
    for (let i = 0; i < n; i++) m.set(u16(ifd + 2 + i * 12), ifd + 2 + i * 12);
    return m;
  };
  const ifd0 = tags(u32(4));
  const exifPtr = ifd0.get(0x8769);
  const exif = exifPtr !== undefined ? tags(u32(exifPtr + 8)) : undefined;
  const entry = exif?.get(0x9003) ?? exif?.get(0x9004) ?? ifd0.get(0x0132);
  if (entry === undefined) return undefined;
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(ascii(entry));
  if (!m || m[1] === "0000") return undefined;
  return { date: `${m[1]}-${m[2]}-${m[3]}`, time: `${m[4]}:${m[5]}` };
}

/** 2025-10-25 → 2025. 10. 25.(토) */
export function takenLabel(t: PhotoTaken): string {
  const [y, mo, d] = t.date.split("-").map(Number);
  const wd = "일월화수목금토"[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${y}. ${mo}. ${d}.(${wd}) ${t.time}`;
}
