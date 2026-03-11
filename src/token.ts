import { execFileSync } from "child_process";
import { readdirSync } from "fs";
import {
  configDirToHash,
  configDirToService,
  readKeychain,
  readPathEntries,
  refreshAccessToken,
  writeKeychain,
} from "./statusbar";

// ANSI color helpers
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

export function formatRemaining(expiresAt: number, now?: number): string {
  const ms = Math.max(0, expiresAt - (now ?? Date.now()));
  if (ms <= 0) return red("expired");
  const totalM = Math.floor(ms / 60_000);
  const m = totalM % 60;
  const totalH = Math.floor(totalM / 60);
  const h = totalH % 24;
  const d = Math.floor(totalH / 24);
  const pp = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return green(`${d}d${pp(h)}h${pp(m)}m`);
  if (totalH >= 1) return green(`${h}h${pp(m)}m`);
  return green(`${pp(totalM)}m${pp(Math.floor((ms % 60_000) / 1000))}s`);
}

interface ParsedTarget {
  type: "CC" | "ST";
  configDir: string;
}

export function parseTarget(target: string): ParsedTarget {
  const m = target.match(/^(CC|ST):(.+)$/);
  if (!m) {
    console.error(`Invalid target format: ${target}`);
    console.error(`Expected <TYPE>:<CLAUDE_CONFIG_DIR> (e.g. CC:/Users/you/.claude)`);
    process.exit(1);
  }
  return { type: m[1] as "CC" | "ST", configDir: m[2] };
}

interface KeychainEntry {
  configDir: string;
  hash: string;
  service: string;
  type: "CC" | "ST";
}

function discoverKeychainEntries(): KeychainEntry[] {
  const home = process.env.HOME ?? "";
  let dump: string;
  try {
    dump = execFileSync("security", ["dump-keychain"], {
      encoding: "utf-8",
      timeout: 5000,
    });
  } catch {
    return [];
  }

  const servicePattern = /^    "svce"<blob>="(Claude Code-credentials[^"]*)"/gm;
  const services = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = servicePattern.exec(dump)) !== null) {
    services.add(match[1]);
  }

  // Build candidate config dirs
  const candidateDirs: string[] = [`${home}/.claude`];
  try {
    const dirEntries = readdirSync(home, { withFileTypes: true });
    for (const e of dirEntries) {
      if (e.isDirectory() && e.name.startsWith(".claude-")) {
        candidateDirs.push(`${home}/${e.name}`);
      }
    }
  } catch {}
  // Add dirs from paths.jsonl cache
  for (const pe of readPathEntries()) {
    if (pe.path && !candidateDirs.includes(pe.path)) {
      candidateDirs.push(pe.path);
    }
  }
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR;
  if (envConfigDir && !candidateDirs.includes(envConfigDir)) {
    candidateDirs.push(envConfigDir);
  }

  // Map services to entries
  const entries: KeychainEntry[] = [];
  const matched = new Set<string>();

  for (const dir of candidateDirs) {
    const hash = configDirToHash(dir);
    for (const type of ["CC", "ST"] as const) {
      const svc = configDirToService(dir, type);
      if (services.has(svc)) {
        entries.push({ configDir: dir, hash, service: svc, type });
        matched.add(svc);
      }
    }
  }

  // Handle unmatched services (unknown config dirs)
  for (const svc of services) {
    if (matched.has(svc)) continue;
    const isST = svc.endsWith("-ST");
    const type: "CC" | "ST" = isST ? "ST" : "CC";
    // Extract hash from service name
    const hashMatch = svc.match(/^Claude Code-credentials-([a-f0-9]{8})(?:-ST)?$/);
    const hash = hashMatch ? hashMatch[1] : "";
    entries.push({ configDir: "(unknown)", hash, service: svc, type });
  }

  return entries;
}

function tokenHelp(): void {
  console.log(`Usage: kawaz-claude-statusline token <command> [options]

Commands:
  list                  List all credential entries
  get <target>          Show entry details
  set <target> <json>   Write JSON to entry (validates before write)
  delete <target...>    Delete entries
  refresh <target...>   Refresh OAuth tokens
  cp <src> <dst>        Copy entry

Target format:
  <TYPE>:<CONFIG_DIR>   TYPE: CC (Claude Code) or ST (statusline)
                        CONFIG_DIR supports ~ expansion

Examples:
  kawaz-claude-statusline token list
  kawaz-claude-statusline token get ST:~/.claude
  kawaz-claude-statusline token refresh ST:~/.claude
  kawaz-claude-statusline token cp CC:~/.claude ST:~/.claude
  kawaz-claude-statusline token delete ST:~/.claude`);
}

function expandConfigDir(dir: string): string {
  const home = process.env.HOME ?? "";
  if (dir.startsWith("~/")) return `${home}${dir.slice(1)}`;
  return dir;
}

function tokenList(): void {
  const entries = discoverKeychainEntries();
  if (entries.length === 0) {
    console.log("No Claude Code credential entries found in Keychain.");
    return;
  }

  // Group by configDir
  const groups = new Map<string, { hash: string; cc?: KeychainEntry; st?: KeychainEntry }>();
  for (const e of entries) {
    const key = e.configDir;
    if (!groups.has(key)) groups.set(key, { hash: e.hash });
    const g = groups.get(key)!;
    if (e.type === "CC") g.cc = e;
    else g.st = e;
  }

  // Header
  const dirWidth = Math.max(20, ...Array.from(groups.keys()).map((k) => k.length));
  const colWidth = 16;
  const header = [
    "CLAUDE_CONFIG_DIR".padEnd(dirWidth),
    "HASH".padEnd(8),
    "CC".padEnd(colWidth),
    "ST".padEnd(colWidth),
  ].join("  ");
  console.log(dim(header));

  for (const [configDir, g] of groups) {
    const hashStr = g.hash || "-";
    const ccStr = getEntryTimeStr(g.cc);
    const stStr = getEntryTimeStr(g.st);
    const line = [
      configDir.padEnd(dirWidth),
      hashStr.padEnd(8),
      ccStr.padEnd(colWidth),
      stStr.padEnd(colWidth),
    ].join("  ");
    console.log(line);
  }
}

function getEntryTimeStr(entry?: KeychainEntry): string {
  if (!entry) return "-";
  const creds = readKeychain(entry.service);
  if (!creds?.claudeAiOauth?.expiresAt) return "-";
  const expiresAt = creds.claudeAiOauth.expiresAt;
  if (Date.now() >= expiresAt) return red("expired");
  return new Date(expiresAt).toISOString().slice(0, 16);
}

function tokenGet(args: string[]): void {
  if (args.length === 0) {
    console.error("Usage: kawaz-claude-statusline token get <target>");
    process.exit(1);
  }
  const { type, configDir: rawDir } = parseTarget(args[0]);
  const configDir = expandConfigDir(rawDir);
  const service = configDirToService(configDir, type);
  const creds = readKeychain(service);

  console.log(`Service:      ${service}`);
  console.log(`Config Dir:   ${configDir}`);
  console.log(`Type:         ${type}`);

  if (!creds) {
    console.log(`Token:        ${red("(not found)")}`);
    return;
  }

  const oauth = creds.claudeAiOauth;
  if (!oauth) {
    console.log(`Token:        ${red("(no claudeAiOauth)")}`);
    return;
  }

  if (oauth.accessToken) {
    const token = oauth.accessToken as string;
    const preview = token.length > 20 ? `${token.slice(0, 15)}...${token.slice(-4)}` : token;
    console.log(`Token:        ${preview} (len=${token.length})`);
  } else {
    console.log(`Token:        ${red("(empty)")}`);
  }

  if (oauth.expiresAt) {
    const d = new Date(oauth.expiresAt);
    console.log(
      `Expires At:   ${d
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, "")}`,
    );
    console.log(`Remaining:    ${formatRemaining(oauth.expiresAt)}`);
  }

  if (oauth.refreshToken) {
    const rt = oauth.refreshToken as string;
    const preview = rt.length > 20 ? `${rt.slice(0, 15)}...${rt.slice(-4)}` : rt;
    console.log(`Refresh:      ${preview} (len=${rt.length})`);
  }

  if (oauth.refreshTokenExpiresAt) {
    const rd = new Date(oauth.refreshTokenExpiresAt);
    console.log(
      `RT Expires:   ${rd
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d+Z$/, "")}`,
    );
    console.log(`RT Remaining: ${formatRemaining(oauth.refreshTokenExpiresAt)}`);
  }
}

function tokenDelete(args: string[]): void {
  if (args.length === 0) {
    console.error("Usage: kawaz-claude-statusline token delete <target...>");
    process.exit(1);
  }
  for (const arg of args) {
    const { type, configDir: rawDir } = parseTarget(arg);
    const configDir = expandConfigDir(rawDir);
    const service = configDirToService(configDir, type);
    const account = process.env.USER ?? "";
    try {
      execFileSync("security", ["delete-generic-password", "-s", service, "-a", account], {
        encoding: "utf-8",
        timeout: 5000,
      });
      console.log(`Deleted: ${service}`);
    } catch {
      console.error(`Failed to delete: ${service} (may not exist)`);
    }
  }
}

function tokenRefresh(args: string[]): void {
  if (args.length === 0) {
    console.error("Usage: kawaz-claude-statusline token refresh <target...>");
    process.exit(1);
  }
  for (const arg of args) {
    const { type, configDir: rawDir } = parseTarget(arg);
    const configDir = expandConfigDir(rawDir);
    const service = configDirToService(configDir, type);
    const creds = readKeychain(service);

    if (!creds?.claudeAiOauth?.refreshToken) {
      console.error(`${red("Error")}: No refresh token found for ${service}`);
      continue;
    }

    const result = refreshAccessToken(creds.claudeAiOauth.refreshToken);
    if (!result) {
      console.error(`${red("Error")}: Refresh failed for ${service}`);
      continue;
    }

    creds.claudeAiOauth = {
      ...creds.claudeAiOauth,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
    };
    if (result.refreshTokenExpiresAt) {
      creds.claudeAiOauth.refreshTokenExpiresAt = result.refreshTokenExpiresAt;
    }
    writeKeychain(service, creds);
    console.log(`Refreshed: ${service} (expires in ${formatRemaining(result.expiresAt)})`);
  }
}

function tokenSet(args: string[]): void {
  if (args.length < 2) {
    console.error("Usage: kawaz-claude-statusline token set <target> <json>");
    process.exit(1);
  }
  const { type, configDir: rawDir } = parseTarget(args[0]);
  const configDir = expandConfigDir(rawDir);
  const service = configDirToService(configDir, type);
  const jsonStr = args.slice(1).join(" ");
  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`Invalid JSON: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  writeKeychain(service, parsed);
  console.log(`Set: ${service}`);
}

function tokenCp(args: string[]): void {
  if (args.length !== 2) {
    console.error("Usage: kawaz-claude-statusline token cp <src> <dst>");
    process.exit(1);
  }
  const src = parseTarget(args[0]);
  const dst = parseTarget(args[1]);
  const srcDir = expandConfigDir(src.configDir);
  const dstDir = expandConfigDir(dst.configDir);
  const srcService = configDirToService(srcDir, src.type);
  const dstService = configDirToService(dstDir, dst.type);

  const creds = readKeychain(srcService);
  if (!creds) {
    console.error(`${red("Error")}: No entry found for ${srcService}`);
    process.exit(1);
  }

  writeKeychain(dstService, creds);
  console.log(`Copied: ${srcService} -> ${dstService}`);
}

export function runToken(args: string[]): void {
  const sub = args[0];

  if (!sub || sub === "--help") {
    tokenHelp();
    return;
  }

  switch (sub) {
    case "list":
      tokenList();
      break;
    case "get":
      tokenGet(args.slice(1));
      break;
    case "set":
      tokenSet(args.slice(1));
      break;
    case "delete":
      tokenDelete(args.slice(1));
      break;
    case "refresh":
      tokenRefresh(args.slice(1));
      break;
    case "cp":
      tokenCp(args.slice(1));
      break;
    default:
      console.error(`Unknown token command: ${sub}`);
      console.error("");
      tokenHelp();
      process.exit(1);
  }
}
