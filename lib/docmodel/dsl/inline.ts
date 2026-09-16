/**
 * Inline mark parser / serializer for the DSL (grammar rule 7).
 *
 *   **bold**                      → { bold: true }
 *   {red}…{/red} {blue}…{/blue}   → color #ff0000 / #0000ff
 *   {color:#rrggbb}…{/color}      → color
 *   [text](url)  <http://…>       → { t: 'link' }
 *   <br>                          → { t: 'br' }   (mainly inside table cells)
 *   trailing `\`                  → the paragraph continues on the next line with a br
 *   \x                            → literal x for any non-alphanumeric x (escape)
 *
 * The parser never throws; unmatched marks degrade to literal text and produce a warning.
 */
import type { Inline } from "../schema";

export const COLOR_SHORTHANDS: Record<string, string> = { red: "#ff0000", blue: "#0000ff" };
const COLOR_BY_HEX: Record<string, string> = Object.fromEntries(Object.entries(COLOR_SHORTHANDS).map(([k, v]) => [v, k]));

export interface InlineParseResult {
  inlines: Inline[];
  /** true when the source ended with an unescaped `\` (continue paragraph on the next line) */
  continues: boolean;
}

type Style = { bold?: boolean; color?: string };

const LINK_SCHEME = /^(https?:\/\/|mailto:|ftp:\/\/)/i;

/** Split off a trailing continuation backslash. */
export function splitContinuation(src: string): { text: string; continues: boolean } {
  const trimmed = src.replace(/[ \t]+$/, "");
  if (!trimmed.endsWith("\\")) return { text: trimmed, continues: false };
  // count trailing backslashes; an odd count means the last one is a continuation marker
  let n = 0;
  for (let i = trimmed.length - 1; i >= 0 && trimmed[i] === "\\"; i--) n++;
  if (n % 2 === 1) return { text: trimmed.slice(0, -1).replace(/[ \t]+$/, ""), continues: true };
  return { text: trimmed, continues: false };
}

function isAlnum(ch: string): boolean {
  return /[A-Za-z0-9]/.test(ch);
}

/**
 * Parse inline marks. `warn` receives human-readable messages for degraded constructs.
 */
export function parseInlines(source: string, warn?: (message: string) => void): InlineParseResult {
  const { text: src, continues } = splitContinuation(source);
  const out: Inline[] = [];
  let buf = "";
  let bold = false;
  const colors: string[] = [];

  const style = (): Style => {
    const s: Style = {};
    if (bold) s.bold = true;
    if (colors.length) s.color = colors[colors.length - 1];
    return s;
  };
  const flush = () => {
    if (!buf) return;
    pushText(out, buf, style());
    buf = "";
  };

  // pre-pass: positions of unescaped `**`; an odd count means the last one is literal
  const boldPositions: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\\") {
      i++;
      continue;
    }
    if (src[i] === "*" && src[i + 1] === "*") {
      boldPositions.push(i);
      i++;
    }
  }
  const literalBoldAt = boldPositions.length % 2 === 1 ? boldPositions[boldPositions.length - 1] : -1;
  if (literalBoldAt >= 0) warn?.("짝이 맞지 않는 ** (굵게) 표시는 문자 그대로 처리했습니다");

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    // escapes
    if (ch === "\\") {
      const next = src[i + 1];
      if (next !== undefined && !isAlnum(next)) {
        buf += next;
        i += 2;
      } else {
        buf += "\\";
        i += 1;
      }
      continue;
    }
    // bold toggle
    if (ch === "*" && src[i + 1] === "*" && i !== literalBoldAt) {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    // color open / close
    if (ch === "{") {
      const m = /^\{(red|blue|color:#[0-9a-fA-F]{6})\}/.exec(src.slice(i));
      if (m) {
        flush();
        const tag = m[1];
        colors.push(tag.startsWith("color:") ? tag.slice(6).toLowerCase() : COLOR_SHORTHANDS[tag]);
        i += m[0].length;
        continue;
      }
      const c = /^\{\/(red|blue|color)\}/.exec(src.slice(i));
      if (c) {
        if (colors.length) {
          flush();
          colors.pop();
        } else {
          warn?.(`여는 표시가 없는 ${c[0]} 는 문자 그대로 처리했습니다`);
          buf += c[0];
        }
        i += c[0].length;
        continue;
      }
    }
    // [text](url)
    if (ch === "[") {
      const m = /^\[([^\]\n]*)\]\(([^)\s]+)\)/.exec(src.slice(i));
      // only a real URL becomes a link; "[부채비율](부채/자본)" is ordinary Korean text
      if (m && (LINK_SCHEME.test(m[2]) || /^www\./i.test(m[2]))) {
        flush();
        out.push({ t: "link", text: m[1] || m[2], href: m[2] });
        i += m[0].length;
        continue;
      }
    }
    // <http://…> and <br>
    if (ch === "<") {
      const rest = src.slice(i);
      const br = /^<br\s*\/?>/i.exec(rest);
      if (br) {
        flush();
        out.push({ t: "br" });
        i += br[0].length;
        continue;
      }
      const m = /^<([^<>\s]+)>/.exec(rest);
      if (m && LINK_SCHEME.test(m[1])) {
        flush();
        out.push({ t: "link", text: m[1], href: m[1] });
        i += m[0].length;
        continue;
      }
    }
    buf += ch;
    i++;
  }
  flush();
  if (colors.length) warn?.("닫히지 않은 색상 표시({red} 등)가 있습니다");
  return { inlines: out, continues };
}

/** Append text to `out`, merging with the previous text inline when the style is identical. */
export function pushText(out: Inline[], text: string, style: Style = {}): void {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.t === "text" && !!last.bold === !!style.bold && (last.color ?? "") === (style.color ?? "") && last.size === undefined && last.font === undefined) {
    last.text += text;
    return;
  }
  const inline: Inline = { t: "text", text };
  if (style.bold) inline.bold = true;
  if (style.color) inline.color = style.color;
  out.push(inline);
}

/** Merge adjacent text inlines with identical styling (normalization used before comparisons). */
export function normalizeInlines(inlines: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const inl of inlines) {
    if (inl.t === "text") {
      if (inl.text === "") continue;
      if (inl.size === undefined && inl.font === undefined) {
        pushText(out, inl.text, { bold: inl.bold, color: inl.color });
        continue;
      }
    }
    out.push({ ...inl });
  }
  return out;
}

const NEEDS_ESCAPE_ANYWHERE = /(\*\*|\\|\{(red|blue|color:#[0-9a-fA-F]{6}|\/(red|blue|color))\}|\[[^\]\n]*\]\([^)\s]+\)|<br\s*\/?>|<(https?:\/\/|mailto:|ftp:\/\/)[^<>\s]+>)/gi;

/** Escape literal text so that parseInlines returns it unchanged. */
export function escapeInlineText(text: string): string {
  return text.replace(NEEDS_ESCAPE_ANYWHERE, (m) => {
    if (m === "**") return "\\*\\*";
    if (m === "\\") return "\\\\";
    return "\\" + m; // escaping the first char is enough to defuse the construct
  });
}

/** Serialize inlines back to DSL markup. `inCell` turns br into `<br>` instead of a continuation. */
export function serializeInlines(inlines: Inline[], opts: { inCell?: boolean } = {}): string {
  let s = "";
  for (const inl of inlines) {
    if (inl.t === "br") {
      s += opts.inCell ? "<br>" : "\\\n";
      continue;
    }
    if (inl.t === "link") {
      s += inl.text === inl.href ? `<${inl.href}>` : `[${inl.text}](${inl.href})`;
      continue;
    }
    let t = escapeInlineText(inl.text);
    if (opts.inCell) t = t.replace(/\|/g, "\\|");
    if (inl.color) {
      const short = COLOR_BY_HEX[inl.color.toLowerCase()];
      t = short ? `{${short}}${t}{/${short}}` : `{color:${inl.color.toLowerCase()}}${t}{/color}`;
    }
    if (inl.bold) t = `**${t}**`;
    s += t;
  }
  return s;
}

/** Plain text of inlines (br → '\n'). */
export function inlinesToPlain(inlines: Inline[]): string {
  return inlines.map((i) => (i.t === "br" ? "\n" : i.text)).join("");
}
