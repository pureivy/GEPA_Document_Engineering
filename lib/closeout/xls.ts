/**
 * 엑셀 97-2003(.xls) → 시트. sheet.ts 의 readXlsx 와 같은 Sheet[] 를 돌려준다.
 *
 * 은행·ERP 내려받기는 아직 .xls 가 흔하고, 이름만 .xls 인 파일도 많다. 앞 바이트로 실제 형식을 가린다:
 * - D0 CF 11 E0 … : 진짜 엑셀 97-2003 — 복합 문서(CFB) 안의 Workbook 스트림을 BIFF8(엑셀 95 는 BIFF5)로 읽는다
 * - PK …          : 이름만 .xls 인 xlsx
 * - < …           : 은행 거래내역에 흔한 HTML 표, 또는 엑셀 2003 XML(SpreadsheetML)
 * - 그 밖         : 탭으로 나눈 텍스트
 *
 * 외부 의존 없이 읽는다. 값만 옮기고 서식·병합·그림은 버린다(readXlsx 와 같다).
 */
import { BUILTIN_DATE_FORMATS, cellNumber, decode, isDateFormatCode, readXlsx, SHEET_MAX_ROWS, type Sheet } from "./sheet";

const RESAVE = "엑셀에서 열어 .xlsx 로 다시 저장해 올려 주세요";

export function readXls(bytes: Uint8Array): Sheet[] {
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) return readBiff(cfbStream(bytes, ["Workbook", "Book"]));
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readXlsx(bytes);
  const text = decodeDocument(bytes);
  const head = text.replace(/^﻿/, "").trimStart();
  if (head.startsWith("<")) {
    if (/<(?:ss:)?Workbook\b[^>]*urn:schemas-microsoft-com:office:spreadsheet/i.test(head) && /<(?:ss:)?Worksheet\b/i.test(head)) return readSpreadsheetMl(head);
    const table = /<table\b/i.test(head) ? readHtmlTable(head) : null;
    if (table?.rows.length) return [table];
  } else if (/\t/.test(head.split(/\r?\n/, 1)[0] ?? "")) return [readTsv(head)];
  throw new Error(`엑셀 97-2003(.xls) 파일로 읽을 수 없습니다 — ${RESAVE}`);
}

// ─── 복합 문서(CFB) ──────────────────────────────────────────────

const END = 0xfffffffa; // 이 값 이상은 체인 끝·빈 칸

/** CFB 안에서 이름이 맞는 첫 스트림의 바이트 */
function cfbStream(buf: Uint8Array, names: string[]): Uint8Array {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const u32 = (o: number) => dv.getUint32(o, true);
  const shift = dv.getUint16(0x1e, true);
  const ssz = 1 << shift;
  const miniShift = dv.getUint16(0x20, true);
  const cutoff = u32(0x38);
  const sector = (id: number) => (id + 1) * ssz;

  // DIFAT: 헤더의 109칸 + DIFAT 섹터 체인 → FAT 섹터 목록
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const id = u32(0x4c + i * 4);
    if (id < END) fatSectors.push(id);
  }
  for (let id = u32(0x44), n = u32(0x48); id < END && n > 0; n--) {
    const off = sector(id);
    for (let i = 0; i < ssz / 4 - 1; i++) {
      const f = u32(off + i * 4);
      if (f < END) fatSectors.push(f);
    }
    id = u32(off + ssz - 4);
  }
  const fat: number[] = [];
  for (const id of fatSectors) for (let i = 0; i < ssz / 4; i++) fat.push(sector(id) + i * 4 + 4 <= buf.length ? u32(sector(id) + i * 4) : 0xffffffff);

  const chain = (start: number, table: number[]): number[] => {
    const out: number[] = [];
    for (let id = start; id < END && out.length <= table.length; id = table[id] ?? 0xffffffff) out.push(id);
    return out;
  };
  const read = (start: number, size: number): Uint8Array => {
    const out = new Uint8Array(chain(start, fat).length * ssz);
    chain(start, fat).forEach((id, i) => out.set(buf.subarray(sector(id), Math.min(sector(id) + ssz, buf.length)), i * ssz));
    return out.subarray(0, size);
  };

  const dir = read(u32(0x30), Number.MAX_SAFE_INTEGER);
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = Math.min(64, ddv.getUint16(o + 0x40, true));
    const name = new TextDecoder("utf-16le").decode(dir.subarray(o, o + Math.max(0, len - 2)));
    entries.push({ name, type: dir[o + 0x42], start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
  }
  const want = names.map((n) => n.toLowerCase());
  const entry = want.map((n) => entries.find((e) => e.type === 2 && e.name.toLowerCase() === n)).find(Boolean);
  if (!entry) {
    if (entries.some((e) => /EncryptedPackage/i.test(e.name))) throw new Error(`암호가 걸린 엑셀 파일은 읽을 수 없습니다 — 암호를 풀고 ${RESAVE.replace("엑셀에서 열어 ", "")}`);
    throw new Error(`엑셀 통합 문서가 아닙니다(Workbook 없음) — ${RESAVE}`);
  }
  if (entry.size >= cutoff) return read(entry.start, entry.size);

  // 작은 스트림은 루트의 미니 스트림 안에 64바이트 단위로 있다
  const root = entries[0];
  const mini = read(root.start, root.size);
  const miniFat: number[] = [];
  const mf = read(u32(0x3c), u32(0x40) * ssz);
  const mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
  for (let o = 0; o + 4 <= mf.length; o += 4) miniFat.push(mdv.getUint32(o, true));
  const msz = 1 << miniShift;
  const ids = chain(entry.start, miniFat);
  const out = new Uint8Array(ids.length * msz);
  ids.forEach((id, i) => out.set(mini.subarray(id * msz, id * msz + msz), i * msz));
  return out.subarray(0, entry.size);
}

// ─── BIFF8 / BIFF5 ──────────────────────────────────────────────

interface Rec {
  type: number;
  data: Uint8Array;
  pos: number;
}

function* records(s: Uint8Array, from = 0): Generator<Rec> {
  const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
  for (let p = from; p + 4 <= s.length; ) {
    const type = dv.getUint16(p, true);
    const len = dv.getUint16(p + 2, true);
    yield { type, data: s.subarray(p + 4, p + 4 + len), pos: p };
    p += 4 + len;
  }
}

const u16 = (d: Uint8Array, o: number) => d[o] | (d[o + 1] << 8);
const u32 = (d: Uint8Array, o: number) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const f64 = (d: Uint8Array, o: number) => new DataView(d.buffer, d.byteOffset + o, 8).getFloat64(0, true);

/** RK: 30비트 정수 또는 상위 30비트 실수, 1번 비트면 100으로 나눈다 */
function rk(v: number): number {
  let n: number;
  if (v & 2) n = (v | 0) >> 2;
  else {
    const b = new DataView(new ArrayBuffer(8));
    b.setUint32(4, v & 0xfffffffc, true);
    n = b.getFloat64(0, true);
  }
  return v & 1 ? n / 100 : n;
}

const CODEPAGES: Record<number, string> = { 949: "euc-kr", 1200: "utf-16le", 932: "shift_jis", 936: "gbk", 950: "big5", 1250: "windows-1250", 1251: "windows-1251", 1252: "windows-1252", 1253: "windows-1253", 1254: "windows-1254", 1257: "windows-1257", 10000: "macintosh", 0x8000: "macintosh", 0x8001: "windows-1252" };
const ERRORS: Record<number, string> = { 0x00: "#NULL!", 0x07: "#DIV/0!", 0x0f: "#VALUE!", 0x17: "#REF!", 0x1d: "#NAME?", 0x24: "#NUM!", 0x2a: "#N/A" };

const latin1 = (d: Uint8Array) => {
  let s = "";
  for (let i = 0; i < d.length; i += 8192) s += String.fromCharCode(...d.subarray(i, i + 8192));
  return s;
};

/** SST 처럼 CONTINUE 로 이어지는 레코드를 한 줄로 읽는다. 글자 도중에 레코드가 바뀌면 새 레코드 첫 바이트가 글자 폭(1/2바이트) 표시다 */
class Segments {
  private i = 0;
  private p = 0;
  constructor(private segs: Uint8Array[]) {}
  private ensure(): Uint8Array {
    while (this.i < this.segs.length && this.p >= this.segs[this.i].length) {
      this.i++;
      this.p = 0;
    }
    if (this.i >= this.segs.length) throw new Error("SST 가 중간에 끊겼습니다");
    return this.segs[this.i];
  }
  u8(): number {
    return this.ensure()[this.p++];
  }
  u16(): number {
    return this.u8() | (this.u8() << 8);
  }
  u32(): number {
    return (this.u16() | (this.u16() << 16)) >>> 0;
  }
  skip(n: number): void {
    while (n > 0) {
      const s = this.ensure();
      const k = Math.min(n, s.length - this.p);
      this.p += k;
      n -= k;
    }
  }
  chars(cch: number, high: boolean): string {
    let out = "";
    let first = true;
    while (cch > 0) {
      if (!first && this.p >= (this.segs[this.i]?.length ?? 0)) {
        this.ensure();
        high = (this.u8() & 1) === 1;
      }
      first = false;
      const s = this.ensure();
      const w = high ? 2 : 1;
      const n = Math.min(cch, Math.floor((s.length - this.p) / w));
      const part = s.subarray(this.p, this.p + n * w);
      out += high ? new TextDecoder("utf-16le").decode(part) : latin1(part);
      this.p += n * w;
      cch -= n;
      if (n === 0 && cch > 0) this.p = s.length; // 홀수 바이트 남음 — 다음 레코드로
    }
    return out;
  }
  /** XLUnicodeRichExtendedString */
  richString(): string {
    const cch = this.u16();
    const flags = this.u8();
    const runs = flags & 0x08 ? this.u16() : 0;
    const ext = flags & 0x04 ? this.u32() : 0;
    const s = this.chars(cch, (flags & 1) === 1);
    this.skip(runs * 4 + ext);
    return s;
  }
}

function readBiff(stream: Uint8Array): Sheet[] {
  const all = [...records(stream)];
  const bof = all[0];
  if (!bof || bof.type !== 0x0809) throw new Error(`엑셀 5.0 이전 형식은 읽을 수 없습니다 — ${RESAVE}`);
  const biff8 = u16(bof.data, 0) === 0x0600;
  let codepage = 1252;
  let date1904 = false;
  const customDate = new Set<number>();
  const xfFormat: number[] = [];
  const sheets: { name: string; pos: number }[] = [];
  let sst: string[] = [];
  const text = (d: Uint8Array) => new TextDecoder(CODEPAGES[codepage] ?? "windows-1252").decode(d);
  /** BIFF8 XLUnicodeString(글자 수 cchBytes 바이트 + 표시 1바이트) / BIFF5 바이트 문자열 */
  const str = (d: Uint8Array, o: number, cchBytes: 1 | 2): string => {
    const cch = cchBytes === 2 ? u16(d, o) : d[o];
    o += cchBytes;
    if (!biff8) return text(d.subarray(o, o + cch));
    const flags = d[o++];
    if (flags & 0x08) o += 2;
    if (flags & 0x04) o += 4;
    return flags & 1 ? new TextDecoder("utf-16le").decode(d.subarray(o, o + cch * 2)) : latin1(d.subarray(o, o + cch));
  };

  for (let k = 1; k < all.length; k++) {
    const { type, data } = all[k];
    if (type === 0x000a) break; // EOF — 통합 문서 영역 끝
    if (type === 0x002f) throw new Error(`암호가 걸린 엑셀 파일은 읽을 수 없습니다 — 암호를 풀고 .xlsx 로 다시 저장해 올려 주세요`);
    else if (type === 0x0042) codepage = u16(data, 0);
    else if (type === 0x0022) date1904 = u16(data, 0) === 1;
    else if (type === 0x041e) {
      if (isDateFormatCode(str(data, 2, biff8 ? 2 : 1))) customDate.add(u16(data, 0));
    } else if (type === 0x00e0) xfFormat.push(u16(data, 2));
    else if (type === 0x0085) {
      if (data[5] === 0) sheets.push({ name: str(data, 6, 1), pos: u32(data, 0) }); // 차트·매크로 시트는 뺀다
    } else if (type === 0x00fc && biff8) {
      const segs = [data];
      while (all[k + 1]?.type === 0x003c) segs.push(all[++k].data);
      const r = new Segments(segs);
      r.u32();
      const unique = r.u32();
      sst = [];
      try {
        for (let i = 0; i < unique; i++) sst.push(r.richString());
      } catch {
        /* 잘린 SST — 읽은 데까지 쓴다 */
      }
    }
  }

  const isDate = (xf: number) => {
    const f = xfFormat[xf];
    return f !== undefined && (BUILTIN_DATE_FORMATS.has(f) || customDate.has(f));
  };
  const num = (n: number, xf: number) => (isDate(xf) && date1904 ? cellNumber(n + 1462, true) : cellNumber(n, isDate(xf)));

  return sheets.map(({ name, pos }) => {
    const grid = new Map<number, string[]>();
    const set = (row: number, col: number, v: string) => {
      let r = grid.get(row);
      if (!r) grid.set(row, (r = []));
      r[col] = v.replace(/\s+/g, " ").trim();
    };
    let pending: { row: number; col: number } | null = null; // 문자열 결과 수식 — 다음 STRING 레코드가 값
    for (const { type, data } of records(stream, pos)) {
      if (type === 0x000a) break;
      const row = u16(data, 0);
      const col = u16(data, 2);
      const xf = u16(data, 4);
      switch (type) {
        case 0x0203: // NUMBER
          set(row, col, num(f64(data, 6), xf));
          break;
        case 0x027e: // RK
          set(row, col, num(rk(u32(data, 6)), xf));
          break;
        case 0x00bd: // MULRK
          for (let i = 0, o = 4; o + 6 <= data.length - 2; i++, o += 6) set(row, col + i, num(rk(u32(data, o + 2)), u16(data, o)));
          break;
        case 0x00fd: // LABELSST
          set(row, col, sst[u32(data, 6)] ?? "");
          break;
        case 0x0204: // LABEL
        case 0x00d6: // RSTRING
          set(row, col, str(data, 6, 2));
          break;
        case 0x0205: // BOOLERR
          set(row, col, data[7] ? (ERRORS[data[6]] ?? "#ERR") : data[6] ? "TRUE" : "FALSE");
          break;
        case 0x0006: // FORMULA — 계산된 값만 쓴다
          if (u16(data, 12) !== 0xffff) set(row, col, num(f64(data, 6), xf));
          else if (data[6] === 0) pending = { row, col };
          else if (data[6] === 1) set(row, col, data[8] ? "TRUE" : "FALSE");
          else if (data[6] === 2) set(row, col, ERRORS[data[8]] ?? "#ERR");
          break;
        case 0x0207: // STRING
          if (pending) set(pending.row, pending.col, str(data, 0, 2));
          pending = null;
          break;
      }
    }
    const rows: string[][] = [];
    const rowNumbers: number[] = [];
    let truncated = false;
    for (const r of [...grid.keys()].sort((a, b) => a - b)) {
      const cells = grid.get(r)!;
      if (!cells.some((c) => c)) continue;
      if (rows.length >= SHEET_MAX_ROWS) {
        truncated = true;
        break;
      }
      rows.push(Array.from({ length: cells.length }, (_, i) => cells[i] ?? ""));
      rowNumbers.push(r + 1);
    }
    return { name, rows, rowNumbers, truncated };
  });
}

// ─── 이름만 .xls 인 텍스트 파일(HTML 표·SpreadsheetML·탭 구분) ─────────────────

/** meta charset 을 따르고, 없으면 UTF-8 → 안 되면 EUC-KR(CP949) */
function decodeDocument(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  const head = latin1(bytes.subarray(0, 4096));
  const cs = /charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase() ?? /encoding\s*=\s*["']([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  if (cs && /euc-?kr|ks_c_5601|cp949|ms949|x-windows-949/.test(cs)) return new TextDecoder("euc-kr").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

const htmlText = (s: string) =>
  decode(s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " "))
    .replace(/\s+/g, " ")
    .trim();

function toSheet(name: string, grid: string[][], rowNos?: number[]): Sheet {
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  let truncated = false;
  grid.forEach((cells, i) => {
    if (truncated || !cells.some((c) => c)) return;
    if (rows.length >= SHEET_MAX_ROWS) {
      truncated = true;
      return;
    }
    rows.push(Array.from({ length: cells.length }, (_, j) => cells[j] ?? ""));
    rowNumbers.push(rowNos?.[i] ?? i + 1);
  });
  return { name, rows, rowNumbers, truncated };
}

/** 은행 '엑셀 저장'에 흔한 HTML 표. 모든 표의 행을 차례로 잇고, colspan 만큼 빈 칸을 채운다 */
function readHtmlTable(html: string): Sheet {
  const body = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, "");
  const grid: string[][] = [];
  for (const tr of body.matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)) {
    const cells: string[] = [];
    for (const td of tr[1].matchAll(/<t([dh])\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)) {
      cells.push(htmlText(td[3].replace(/<\/t[dh]>[\s\S]*$/i, "")));
      const span = Number(/colspan\s*=\s*["']?(\d+)/i.exec(td[2])?.[1] ?? 1);
      for (let k = 1; k < Math.min(span, 100); k++) cells.push("");
    }
    grid.push(cells);
  }
  return toSheet("표", grid);
}

/** 엑셀 2003 XML 스프레드시트 — <Worksheet ss:Name><Table><Row><Cell><Data ss:Type> */
function readSpreadsheetMl(xml: string): Sheet[] {
  const sheets: Sheet[] = [];
  for (const ws of xml.matchAll(/<(?:ss:)?Worksheet\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Worksheet>/gi)) {
    const name = decode(/Name="([^"]*)"/i.exec(ws[1])?.[1] ?? `시트${sheets.length + 1}`);
    const grid: string[][] = [];
    const rowNos: number[] = [];
    let r = 0;
    for (const row of ws[2].matchAll(/<(?:ss:)?Row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Row>)/gi)) {
      r = Number(/Index="(\d+)"/i.exec(row[1])?.[1] ?? r + 1);
      const cells: string[] = [];
      let c = 0;
      for (const cell of (row[2] ?? "").matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
        c = Number(/Index="(\d+)"/i.exec(cell[1])?.[1] ?? c + 1);
        const data = /<(?:ss:)?Data\b([^>]*)>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(cell[2] ?? "");
        if (!data) continue;
        const type = /Type="(\w+)"/i.exec(data[1])?.[1];
        let v = htmlText(data[2]);
        if (type === "Number" && Number.isFinite(Number(v))) v = cellNumber(Number(v), false);
        else if (type === "DateTime") v = /T00:00:00/.test(v) ? v.slice(0, 10) : v.slice(0, 16).replace("T", " ");
        cells[c - 1] = v;
      }
      grid.push(Array.from({ length: cells.length }, (_, i) => cells[i] ?? ""));
      rowNos.push(r);
    }
    sheets.push(toSheet(name, grid, rowNos));
  }
  return sheets;
}

function readTsv(text: string): Sheet {
  return toSheet(
    "텍스트",
    text.split(/\r?\n/).map((l) => l.split("\t").map((c) => c.replace(/^"(.*)"$/, "$1").trim())),
  );
}
