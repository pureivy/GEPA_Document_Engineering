import { describe, it, expect } from "vitest";
import path from "node:path";
import { exeName, rhwpBin, resolveConfiguredPath, findOnPath, quoteForCmd, pdftotextBin } from "../lib/platform";

describe("platform helpers", () => {
  it("exeName appends .exe only on Windows and only without an extension", () => {
    expect(exeName("rhwp", "win32")).toBe("rhwp.exe");
    expect(exeName("claude.cmd", "win32")).toBe("claude.cmd");
    expect(exeName("rhwp", "darwin")).toBe("rhwp");
    expect(exeName("rhwp", "linux")).toBe("rhwp");
  });
  it("rhwpBin honours RHWP_BIN (absolute or relative) and defaults to bin/rhwp[.exe]", () => {
    expect(rhwpBin({}, "/w", "darwin")).toBe(path.join("/w", "bin", "rhwp"));
    expect(rhwpBin({}, "/w", "win32")).toBe(path.join("/w", "bin", "rhwp.exe"));
    expect(rhwpBin({ RHWP_BIN: "tools/rhwp" }, "/w", "linux")).toBe(path.join("/w", "tools", "rhwp"));
    expect(rhwpBin({ RHWP_BIN: "/opt/rhwp" }, "/w", "linux")).toBe("/opt/rhwp");
  });
  it("resolveConfiguredPath expands ~", () => {
    expect(resolveConfiguredPath("~/x/claude")).toMatch(/^\/.*\/x\/claude$/);
  });
  it("findOnPath walks PATH with PATHEXT on Windows", () => {
    const dir = path.join(process.cwd(), "bin");
    // this repo ships bin/rhwp (mac binary) — found on a POSIX PATH, not with a Windows PATHEXT
    expect(findOnPath("rhwp", { PATH: dir }, "darwin")).toBe(path.join(dir, "rhwp"));
    expect(findOnPath("rhwp", { PATH: dir, PATHEXT: ".EXE;.CMD" }, "win32")).toBeNull();
    expect(findOnPath("nope", { PATH: dir }, "darwin")).toBeNull();
  });
  it("quoteForCmd wraps arguments with spaces/quotes for cmd.exe", () => {
    expect(quoteForCmd("plain")).toBe("plain");
    expect(quoteForCmd("C:\\Program Files\\x")).toBe('"C:\\Program Files\\x"');
    expect(quoteForCmd('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteForCmd("100%")).toBe('"100%%"');
  });
  it("pdftotextBin falls back to a bare name when nothing is installed", () => {
    expect(pdftotextBin({ PATH: "/nonexistent" }, "linux")).toBe("pdftotext");
    expect(pdftotextBin({ PATH: "C:\\nonexistent", PATHEXT: ".EXE" }, "win32")).toBe("pdftotext.exe");
    expect(pdftotextBin({ PDFTOTEXT_BIN: "/opt/pdftotext" }, "linux")).toBe("/opt/pdftotext");
  });
});
