/**
 * OS-specific bits in one place so the app runs on macOS, Windows and Linux:
 *   - external binaries (rhwp CLI, pdftotext, the claude CLI) and where to find them
 *   - spawning `.cmd` shims on Windows (npm global installs) without a shell-quoting hole
 * Every function takes the platform as an optional parameter so tests can exercise both paths.
 */
import { spawn, spawnSync, type ChildProcess, type SpawnOptions, type SpawnSyncOptionsWithStringEncoding, type SpawnSyncReturns } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type Platform = NodeJS.Platform;
/** environment map (process.env or a test stub) */
export type Env = Record<string, string | undefined>;

export const isWindows = (platform: Platform = process.platform): boolean => platform === "win32";

/** `name` → `name.exe` on Windows (unless it already has an extension). */
export function exeName(name: string, platform: Platform = process.platform): string {
  return isWindows(platform) && !/\.(exe|cmd|bat)$/i.test(name) ? `${name}.exe` : name;
}

/** Absolute path for a configured binary (absolute stays; relative is resolved against cwd). */
export function resolveConfiguredPath(value: string, cwd = process.cwd()): string {
  const v = value.trim().replace(/^~(?=$|[\\/])/, homedir());
  return path.isAbsolute(v) ? v : path.join(cwd, v);
}

/** First match of `name` on PATH (like `which`/`where`), or null. */
export function findOnPath(name: string, env: Env = process.env, platform: Platform = process.platform): string | null {
  const dirs = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean);
  const exts = isWindows(platform) ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, /\.[a-z]+$/i.test(name) ? name : name + ext);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * The rhwp CLI: `RHWP_BIN`, else `bin/rhwp` (`bin/rhwp.exe` on Windows).
 * Release assets: https://github.com/edwardkim/rhwp/releases (macos-aarch64/x86_64, linux, windows-x86_64).
 */
export function rhwpBin(env: Env = process.env, cwd = process.cwd(), platform: Platform = process.platform): string {
  if (env.RHWP_BIN?.trim()) return resolveConfiguredPath(env.RHWP_BIN, cwd);
  return path.join(cwd, "bin", exeName("rhwp", platform));
}

/** pdftotext (poppler): `PDFTOTEXT_BIN`, PATH, then the usual Windows install locations. */
export function pdftotextBin(env: Env = process.env, platform: Platform = process.platform): string {
  if (env.PDFTOTEXT_BIN?.trim()) return resolveConfiguredPath(env.PDFTOTEXT_BIN);
  const onPath = findOnPath("pdftotext", env, platform);
  if (onPath) return onPath;
  if (isWindows(platform)) {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs"), "C:\\poppler", "C:\\tools"].filter(Boolean) as string[];
    for (const root of roots) {
      for (const sub of ["poppler\\Library\\bin", "poppler\\bin", "poppler-25.07.0\\Library\\bin", "poppler-24.08.0\\Library\\bin"]) {
        const c = path.join(root, sub, "pdftotext.exe");
        if (existsSync(c)) return c;
      }
    }
  }
  return exeName("pdftotext", platform); // let spawn report ENOENT with a helpful message
}

/**
 * The Claude Code CLI. Order: `CLAUDE_BIN`, native installer location (`~/.local/bin/claude[.exe]`),
 * npm global shim on Windows (`%APPDATA%\npm\claude.cmd`), PATH, then bare `claude`.
 */
export function resolveClaudeBin(env: Env = process.env, platform: Platform = process.platform): string {
  const fromEnv = env.CLAUDE_BIN?.trim();
  if (fromEnv) return resolveConfiguredPath(fromEnv);
  const local = path.join(homedir(), ".local", "bin", exeName("claude", platform));
  if (existsSync(local)) return local;
  if (isWindows(platform)) {
    const shim = env.APPDATA ? path.join(env.APPDATA, "npm", "claude.cmd") : null;
    if (shim && existsSync(shim)) return shim;
  }
  return findOnPath("claude", env, platform) ?? "claude";
}

/** Quote one argument for `cmd.exe /s /c "…"` (only needed for .cmd/.bat shims). */
export function quoteForCmd(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/%/g, "%%")}"`;
}

/**
 * spawn() that also runs Windows `.cmd`/`.bat` shims (npm global installs) — Node cannot exec
 * those directly, so they go through `cmd.exe /d /s /c` with every argument quoted here
 * (no `shell: true`, whose quoting is left to the caller).
 */
export function spawnCommand(bin: string, args: string[], opts: SpawnOptions = {}, platform: Platform = process.platform): ChildProcess {
  if (isWindows(platform) && /\.(cmd|bat)$/i.test(bin)) {
    const line = [bin, ...args].map(quoteForCmd).join(" ");
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...opts, windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawn(bin, args, { ...opts, windowsHide: true });
}

/** spawnSync counterpart used by scripts and the reference-document converters. */
export function spawnCommandSync(bin: string, args: string[], opts: SpawnSyncOptionsWithStringEncoding = { encoding: "utf8" }, platform: Platform = process.platform): SpawnSyncReturns<string> {
  if (isWindows(platform) && /\.(cmd|bat)$/i.test(bin)) {
    const line = [bin, ...args].map(quoteForCmd).join(" ");
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...opts, windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawnSync(bin, args, { ...opts, windowsHide: true });
}
