import { describe, expect, it } from "vitest";
import { parseInlines, serializeInlines, escapeInlineText } from "../../lib/docmodel/dsl/inline";

describe("parseInlines", () => {
  it("parses bold, colours, links and br", () => {
    expect(parseInlines("가 **나** 다").inlines).toEqual([
      { t: "text", text: "가 " },
      { t: "text", text: "나", bold: true },
      { t: "text", text: " 다" },
    ]);
    expect(parseInlines("{red}빨강{/red}{blue}파랑{/blue}{color:#00AA00}초록{/color}").inlines).toEqual([
      { t: "text", text: "빨강", color: "#ff0000" },
      { t: "text", text: "파랑", color: "#0000ff" },
      { t: "text", text: "초록", color: "#00aa00" },
    ]);
    expect(parseInlines("**{red}둘 다{/red}**").inlines).toEqual([{ t: "text", text: "둘 다", bold: true, color: "#ff0000" }]);
    expect(parseInlines("[홈페이지](http://www.gepa.kr) <https://x.kr/a> <mailto:a@b.c>").inlines).toEqual([
      { t: "link", text: "홈페이지", href: "http://www.gepa.kr" },
      { t: "text", text: " " },
      { t: "link", text: "https://x.kr/a", href: "https://x.kr/a" },
      { t: "text", text: " " },
      { t: "link", text: "mailto:a@b.c", href: "mailto:a@b.c" },
    ]);
    expect(parseInlines("가<br>나<br/>다").inlines).toEqual([{ t: "text", text: "가" }, { t: "br" }, { t: "text", text: "나" }, { t: "br" }, { t: "text", text: "다" }]);
  });
  it("detects the trailing continuation backslash", () => {
    expect(parseInlines("첫 줄 \\")).toEqual({ inlines: [{ t: "text", text: "첫 줄" }], continues: true });
    expect(parseInlines("역슬래시 \\\\").continues).toBe(false);
  });
  it("degrades unmatched marks to literal text with a warning", () => {
    const warns: string[] = [];
    expect(parseInlines("공급가액의 80%** 이내", (m) => warns.push(m)).inlines).toEqual([{ t: "text", text: "공급가액의 80%** 이내" }]);
    expect(warns).toHaveLength(1);
    expect(parseInlines("닫기만 {/red} 있음", (m) => warns.push(m)).inlines).toEqual([{ t: "text", text: "닫기만 {/red} 있음" }]);
    expect(parseInlines("<not a link>").inlines).toEqual([{ t: "text", text: "<not a link>" }]);
    expect(parseInlines("[대괄호] 텍스트").inlines).toEqual([{ t: "text", text: "[대괄호] 텍스트" }]);
  });
  it("supports backslash escapes", () => {
    expect(parseInlines("\\*\\*굵게 아님\\*\\* \\{red\\} C:\\Users").inlines).toEqual([{ t: "text", text: "**굵게 아님** {red} C:\\Users" }]);
  });
});

describe("serializeInlines", () => {
  it("round-trips styled text through parseInlines", () => {
    const samples = ["가 **나** 다", "{red}빨강{/red} **{blue}굵은 파랑{/blue}**", "[홈페이지](http://www.gepa.kr) <https://x.kr/>", "리터럴 ** 별표 {red} 와 [링크](x) 와 <br> 와 \\ 역슬래시", "{color:#123456}색{/color}"];
    for (const s of samples) {
      const inl = parseInlines(s).inlines;
      const again = parseInlines(serializeInlines(inl, { inCell: true })).inlines;
      expect(again).toEqual(inl);
    }
  });
  it("escapes literal constructs", () => {
    expect(escapeInlineText("a**b")).toBe("a\\*\\*b");
    expect(escapeInlineText("{red}x")).toBe("\\{red}x");
    expect(escapeInlineText("[t](u)")).toBe("\\[t](u)");
    expect(escapeInlineText("<br>")).toBe("\\<br>");
    expect(escapeInlineText("C:\\x")).toBe("C:\\\\x");
  });
  it("uses <br> inside cells and continuation outside", () => {
    const inl = parseInlines("가<br>나").inlines;
    expect(serializeInlines(inl, { inCell: true })).toBe("가<br>나");
    expect(serializeInlines(inl)).toBe("가\\\n나");
  });
});
