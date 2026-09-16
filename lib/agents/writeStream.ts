/**
 * Incremental decoder for a streamed `Write` tool call.
 *
 * The CLI streams a tool call's input as `input_json_delta` fragments (our `tool.input.delta`
 * events): partial JSON of `{"file_path": "...", "content": "..."}`. This class consumes the
 * fragments as they arrive and emits the decoded `content` string piece by piece, so the
 * document the agent is writing to disk can be typed into the editor while it is being written
 * — the agent no longer has to repeat the whole document in its final answer.
 *
 * Only top-level string values are interpreted; everything else is skipped. Escapes that are
 * cut by a fragment boundary (`\`, `\u12`) are held back until the rest arrives.
 */

export interface WriteStreamCallbacks {
  /** decoded characters of the `content` value, in order */
  onContent?: (text: string) => void;
  /** the complete `file_path` value, as soon as its closing quote has arrived */
  onFilePath?: (path: string) => void;
}

type Phase = "start" | "key" | "colon" | "value" | "string" | "skip" | "end";

export class WriteStreamDecoder {
  private raw = "";
  private pos = 0;
  private phase: Phase = "start";
  private depth = 0;
  private str = ""; // current string token (decoded)
  private key: string | null = null; // key of the value being read at depth 1
  private inString = false;
  private stringIsKey = false;
  private stringIsContent = false;
  private skipDepth = 0;
  private skipString = false;
  private skipEscape = false;
  readonly cb: WriteStreamCallbacks;
  filePath: string | null = null;
  content = "";
  contentClosed = false;

  constructor(cb: WriteStreamCallbacks = {}) {
    this.cb = cb;
  }

  push(fragment: string): void {
    if (!fragment) return;
    this.raw += fragment;
    this.scan();
    // drop consumed prefix so memory does not grow with the document
    if (this.pos > 4096) {
      this.raw = this.raw.slice(this.pos);
      this.pos = 0;
    }
  }

  private scan(): void {
    const s = this.raw;
    while (this.pos < s.length && this.phase !== "end") {
      const ch = s[this.pos];
      if (this.inString) {
        if (ch === "\\") {
          const dec = decodeEscape(s, this.pos);
          if (dec === null) return; // wait for more input
          this.append(dec.text);
          this.pos += dec.length;
          continue;
        }
        if (ch === '"') {
          this.pos++;
          this.endString();
          continue;
        }
        this.append(ch);
        this.pos++;
        continue;
      }
      if (this.phase === "skip") {
        // skip a nested object/array value verbatim
        if (this.skipString) {
          if (this.skipEscape) this.skipEscape = false;
          else if (ch === "\\") this.skipEscape = true;
          else if (ch === '"') this.skipString = false;
        } else if (ch === '"') this.skipString = true;
        else if (ch === "{" || ch === "[") this.skipDepth++;
        else if (ch === "}" || ch === "]") {
          this.skipDepth--;
          if (this.skipDepth === 0) this.phase = "key"; // value done; expect , or }
        }
        this.pos++;
        continue;
      }
      if (isWs(ch) || ch === ",") {
        this.pos++;
        continue;
      }
      switch (this.phase) {
        case "start":
          if (ch === "{") {
            this.depth = 1;
            this.phase = "key";
          }
          this.pos++;
          break;
        case "key":
          if (ch === '"') {
            this.inString = true;
            this.stringIsKey = true;
            this.str = "";
          } else if (ch === "}") {
            this.phase = "end";
          }
          this.pos++;
          break;
        case "colon":
          if (ch === ":") this.phase = "value";
          this.pos++;
          break;
        case "value":
          if (ch === '"') {
            this.inString = true;
            this.stringIsKey = false;
            this.stringIsContent = this.key === "content";
            this.str = "";
            this.pos++;
          } else if (ch === "{" || ch === "[") {
            this.phase = "skip";
            this.skipDepth = 1;
            this.skipString = false;
            this.skipEscape = false;
            this.pos++;
          } else {
            // number / true / false / null — consume until a delimiter
            let j = this.pos;
            while (j < s.length && !isWs(s[j]) && s[j] !== "," && s[j] !== "}") j++;
            if (j === s.length) return; // wait for the delimiter
            this.pos = j;
            this.phase = "key";
          }
          break;
        default:
          this.pos++;
      }
    }
  }

  private append(text: string): void {
    if (this.stringIsKey) {
      this.str += text;
      return;
    }
    if (this.stringIsContent) {
      this.content += text;
      this.cb.onContent?.(text);
      return;
    }
    this.str += text;
  }

  private endString(): void {
    this.inString = false;
    if (this.stringIsKey) {
      this.key = this.str;
      this.phase = "colon";
      return;
    }
    if (this.stringIsContent) {
      this.contentClosed = true;
    } else if (this.key === "file_path") {
      this.filePath = this.str;
      this.cb.onFilePath?.(this.str);
    }
    this.key = null;
    this.stringIsContent = false;
    this.phase = "key";
  }
}

function isWs(ch: string): boolean {
  return ch === " " || ch === "\n" || ch === "\r" || ch === "\t";
}

/** Decode one JSON escape at `s[i] === "\\"`; null when the fragment ends mid-escape. */
function decodeEscape(s: string, i: number): { text: string; length: number } | null {
  const n = s[i + 1];
  if (n === undefined) return null;
  switch (n) {
    case '"':
      return { text: '"', length: 2 };
    case "\\":
      return { text: "\\", length: 2 };
    case "/":
      return { text: "/", length: 2 };
    case "b":
      return { text: "\b", length: 2 };
    case "f":
      return { text: "\f", length: 2 };
    case "n":
      return { text: "\n", length: 2 };
    case "r":
      return { text: "\r", length: 2 };
    case "t":
      return { text: "\t", length: 2 };
    case "u": {
      const hex = s.slice(i + 2, i + 6);
      if (hex.length < 4) return null;
      const code = parseInt(hex, 16);
      if (Number.isNaN(code)) return { text: "\\u" + hex, length: 6 };
      // surrogate pair: wait for the low half so we never emit a lone surrogate
      if (code >= 0xd800 && code <= 0xdbff) {
        if (s.length < i + 12) return null;
        if (s[i + 6] === "\\" && s[i + 7] === "u") {
          const lo = parseInt(s.slice(i + 8, i + 12), 16);
          if (lo >= 0xdc00 && lo <= 0xdfff) return { text: String.fromCharCode(code, lo), length: 12 };
        }
      }
      return { text: String.fromCharCode(code), length: 6 };
    }
    default:
      return { text: n, length: 2 };
  }
}
