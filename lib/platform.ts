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
 * The native executable behind an npm `.cmd` shim, when the npm layout has one. `claude.cmd`
 * is a batch file whose only job is to run the claude-code package's bundled `claude.exe`,
 * so going through cmd.exe buys nothing and costs correctness - see spawnCommand.
 */
export function nativeBinForShim(shim: string, platform: Platform = process.platform): string | null {
  if (!isWindows(platform) || !/\.(cmd|bat)$/i.test(shim)) return null;
  const candidate = path.join(path.dirname(shim), "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
  return existsSync(candidate) ? candidate : null;
}

/**
 * The Claude Code CLI. Order: `CLAUDE_BIN`, native installer location (`~/.local/bin/claude[.exe]`),
 * npm global shim on Windows (`%APPDATA%/npm/claude.cmd`), PATH, then bare `claude`.
 * A `.cmd` shim is upgraded to the native `.exe` it wraps whenever that file is present.
 */
export function resolveClaudeBin(env: Env = process.env, platform: Platform = process.platform): string {
  const native = (p: string) => nativeBinForShim(p, platform) ?? p;
  const fromEnv = env.CLAUDE_BIN?.trim();
  if (fromEnv) return native(resolveConfiguredPath(fromEnv));
  const local = path.join(homedir(), ".local", "bin", exeName("claude", platform));
  if (existsSync(local)) return local;
  if (isWindows(platform)) {
    const shim = env.APPDATA ? path.join(env.APPDATA, "npm", "claude.cmd") : null;
    if (shim && existsSync(shim)) return native(shim);
  }
  const onPath = findOnPath("claude", env, platform);
  return onPath ? native(onPath) : "claude";
}

/** Quote one argument for `cmd.exe /s /c "…"` (only needed for .cmd/.bat shims). */
export function quoteForCmd(arg: string): string {
  if (arg === "") return '""';
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/%/g, "%%")}"`;
}

/**
 * cmd.exe ends its command line at the first newline, so an argument containing one silently
 * truncates the call and drops every argument after it - that is how --append-system-prompt
 * was swallowing --tools/--add-dir/--allowedTools on Windows. Fail loudly instead.
 */
function assertSingleLineArgs(bin: string, args: string[]): void {
  const i = args.findIndex((a) => a.includes(String.fromCharCode(10)) || a.includes(String.fromCharCode(13)));
  if (i === -1) return;
  throw new Error(
    `Cannot pass a multi-line argument (index ${i}: ${JSON.stringify(args[i].slice(0, 60))}...) through the Windows shim ` +
      `${bin}: cmd.exe would truncate the command line and drop every later argument. ` +
      "Point CLAUDE_BIN at the native .exe instead.",
  );
}

/**
 * spawn() that also runs Windows `.cmd`/`.bat` shims (npm global installs) — Node cannot exec
 * those directly, so they go through `cmd.exe /d /s /c` with every argument quoted here
 * (no `shell: true`, whose quoting is left to the caller).
 */
export function spawnCommand(bin: string, args: string[], opts: SpawnOptions = {}, platform: Platform = process.platform): ChildProcess {
  if (isWindows(platform) && /\.(cmd|bat)$/i.test(bin)) {
    assertSingleLineArgs(bin, args);
    const line = [bin, ...args].map(quoteForCmd).join(" ");
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...opts, windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawn(bin, args, { ...opts, windowsHide: true });
}

/**
 * Whether to spawn a child `detached`, for a child we later kill as a whole tree.
 * POSIX: true, so the child leads its own process group and `kill(-pid)` reaches its children.
 * Windows: always false. `detached` maps to DETACHED_PROCESS (no console), and a `.cmd`/`.bat`
 * shim runs through cmd.exe, which then exits 1 immediately with no stdout or stderr. Windows
 * has no process groups anyway, so detaching bought nothing here - killTree() uses taskkill.
 */
export function detachChild(platform: Platform = process.platform): boolean {
  return !isWindows(platform);
}

/**
 * Kill a child and every process it spawned.
 * POSIX: negative pid = the child's process group (needs detachChild()).
 * Windows: no process groups and no real signals, so taskkill walks the tree by pid.
 */
export function killTree(child: ChildProcess, signal: NodeJS.Signals = "SIGTERM", platform: Platform = process.platform): void {
  const pid = child.pid;
  if (!pid) return;
  if (isWindows(platform)) {
    // Every Windows kill is a hard TerminateProcess; the caller's SIGTERM/SIGKILL grace period
    // still applies, it just cannot ask the tree to shut down gracefully first.
    const r = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
    if (r.error || r.status !== 0) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
    return;
  }
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/** spawnSync counterpart used by scripts and the reference-document converters. */
export function spawnCommandSync(bin: string, args: string[], opts: SpawnSyncOptionsWithStringEncoding = { encoding: "utf8" }, platform: Platform = process.platform): SpawnSyncReturns<string> {
  if (isWindows(platform) && /\.(cmd|bat)$/i.test(bin)) {
    assertSingleLineArgs(bin, args);
    const line = [bin, ...args].map(quoteForCmd).join(" ");
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...opts, windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawnSync(bin, args, { ...opts, windowsHide: true });
}
