#!/usr/bin/env bun
// @bun

// src/cli.ts
import { readFileSync as readFileSync2, writeFileSync } from "fs";
import { isatty } from "tty";

// src/statusbar.ts
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync } from "fs";

// src/bar.ts
function calcElapsed(resetsAt, windowHours, now) {
  const reset = new Date(resetsAt);
  if (isNaN(reset.getTime()))
    return 0;
  const nowMs = (now ?? new Date).getTime();
  const windowMs = windowHours * 3600000;
  const windowStart = reset.getTime() - windowMs;
  const elapsed = (nowMs - windowStart) / windowMs * 100;
  return Math.max(0, Math.min(100, elapsed));
}
function dualBar(util, elapsed, width) {
  const TU = util >= 80 ? "196" : util >= 50 ? "220" : "40";
  const BU = "39";
  const BA = "24";
  const topFilled = Math.round(util / 100 * width);
  const botFilled = Math.round(elapsed / 100 * width);
  const TA = "240";
  let bar = "";
  for (let i = 0;i < width; i++) {
    const fg = i < topFilled ? TU : TA;
    const bg = i < botFilled ? BU : BA;
    bar += `\x1B[38;5;${fg}m\x1B[48;5;${bg}m\u2580`;
  }
  return bar + "\x1B[0m";
}
function contextBar(pct, width) {
  const ctxColor = pct >= 80 ? "196" : pct >= 50 ? "220" : "40";
  const ctxGray = pct >= 80 ? "52" : pct >= 50 ? "58" : "22";
  const fullCells = Math.floor(pct / 10);
  const onesDigit = pct % 10;
  const blockChars = " \u258F\u258E\u258D\u258C\u258B\u258A\u2589\u2588";
  const partialChar = blockChars[Math.round(onesDigit * 8 / 9)] ?? "\u2588";
  const ctxText = `${pct}%`;
  const effectiveFilled = onesDigit >= 7 ? fullCells + 1 : fullCells;
  let ctxTextStart;
  if (effectiveFilled >= Math.ceil(width / 2)) {
    const visualWidth = fullCells + Math.max(0, onesDigit - 1) / blockChars.length;
    ctxTextStart = Math.round((visualWidth - ctxText.length) / 2);
    if (ctxTextStart < 0)
      ctxTextStart = 0;
  } else {
    const availStart = fullCells + (onesDigit > 0 ? 1 : 0);
    const availWidth = width - availStart;
    ctxTextStart = availStart + Math.round((availWidth - ctxText.length) / 2);
    if (ctxTextStart + ctxText.length > width)
      ctxTextStart = width - ctxText.length;
  }
  let bar = "";
  for (let i = 0;i < width; i++) {
    const isFull = i < fullCells;
    const isPartial = i === fullCells && onesDigit > 0;
    if (i >= ctxTextStart && i < ctxTextStart + ctxText.length) {
      if (isFull || isPartial) {
        bar += `\x1B[0m\x1B[1m\x1B[30m\x1B[48;5;${ctxColor}m${ctxText[i - ctxTextStart]}`;
      } else {
        bar += `\x1B[0m\x1B[1m\x1B[38;5;${ctxColor}m\x1B[48;5;${ctxGray}m${ctxText[i - ctxTextStart]}`;
      }
    } else if (isPartial) {
      bar += `\x1B[0m\x1B[38;5;${ctxColor}m\x1B[48;5;${ctxGray}m${partialChar}`;
    } else {
      bar += `\x1B[0m\x1B[48;5;${isFull ? ctxColor : ctxGray}m `;
    }
  }
  bar += "\x1B[0m";
  return bar;
}

// src/statusbar.ts
function osc(url, text) {
  return `\x1B]8;;${url}\x07${text}\x1B]8;;\x07`;
}
function encPath(path) {
  return path.split("/").map(encodeURIComponent).join("/");
}
function parseRepo(dir) {
  const m = dir.match(/\/repos\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (!m)
    return null;
  return { host: m[1], owner: m[2], repo: m[3] };
}
function readKeychain(service) {
  for (const args of [
    ["find-generic-password", "-s", service, "-a", process.env.USER ?? "", "-w"],
    ["find-generic-password", "-s", service, "-w"]
  ]) {
    try {
      return JSON.parse(execFileSync("security", args, { encoding: "utf-8", timeout: 3000 }));
    } catch {}
  }
  return null;
}
function writeKeychain(service, creds) {
  try {
    execFileSync("security", [
      "add-generic-password",
      "-U",
      "-s",
      service,
      "-a",
      process.env.USER ?? "",
      "-w",
      JSON.stringify(creds)
    ], { encoding: "utf-8", timeout: 5000 });
  } catch {}
}
function refreshAccessToken(refreshToken) {
  try {
    const res = execFileSync("curl", [
      "-sf",
      "--max-time",
      "15",
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "-d",
      JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        scope: "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
      }),
      "https://platform.claude.com/v1/oauth/token"
    ], { encoding: "utf-8", timeout: 20000 });
    const data = JSON.parse(res);
    if (!data.access_token)
      return null;
    const result = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 28800) * 1000
    };
    if (data.refresh_token_expires_at) {
      result.refreshTokenExpiresAt = data.refresh_token_expires_at;
    } else if (data.refresh_token_expires_in) {
      result.refreshTokenExpiresAt = Date.now() + data.refresh_token_expires_in * 1000;
    }
    return result;
  } catch {
    return null;
  }
}
function configDirToService(configDir, type) {
  const home = process.env.HOME ?? "";
  const base = configDir === `${home}/.claude` ? "Claude Code-credentials" : `Claude Code-credentials-${createHash("sha256").update(configDir).digest("hex").slice(0, 8)}`;
  return type === "ST" ? `${base}-ST` : base;
}
function configDirToHash(configDir) {
  const home = process.env.HOME ?? "";
  return configDir === `${home}/.claude` ? "" : createHash("sha256").update(configDir).digest("hex").slice(0, 8);
}
function readPathEntries() {
  const cacheDir = `${process.env.XDG_CACHE_HOME || `${process.env.HOME}/.cache`}/kawaz-claude-statusline`;
  const pathsFile = `${cacheDir}/paths.jsonl`;
  try {
    const content = readFileSync(pathsFile, "utf-8");
    const entries = [];
    for (const line of content.split(`
`).filter((l) => l.trim())) {
      try {
        entries.push(JSON.parse(line));
      } catch {}
    }
    return entries;
  } catch {
    return [];
  }
}
function runStatusbar() {
  const raw = readFileSync("/dev/stdin", "utf-8");
  if (!raw.trim()) {
    console.error("Error: No input on stdin. This command expects JSON from Claude Code.");
    process.exit(1);
  }
  const input = JSON.parse(raw);
  const cwd = input.workspace?.current_dir ?? "";
  const repo = parseRepo(cwd);
  const encCwd = encPath(cwd);
  const finderLink = osc(`file://${encCwd}`, "\uD83D\uDCC2");
  const vscodeLink = osc(`vscode://file${encCwd}`, "[VSCode]");
  let locationLine;
  if (repo) {
    const ownerUrl = `https://${repo.host}/${repo.owner}`;
    const repoUrl = `https://${repo.host}/${repo.owner}/${repo.repo}`;
    const dimBlue = "\x1B[2;34m";
    const blue = "\x1B[34m";
    const rst = "\x1B[0m";
    locationLine = `${finderLink} ${vscodeLink} ${dimBlue}${osc(ownerUrl, repo.owner)}${rst}/${blue}${osc(repoUrl, repo.repo)}${rst}`;
  } else {
    locationLine = `${finderLink} ${vscodeLink} ` + osc(`file://${encCwd}`, cwd);
  }
  let vcsInfo = "";
  let currentBookmark = "";
  const jjOpts = {
    cwd,
    encoding: "utf-8",
    timeout: 3000,
    stdio: ["pipe", "pipe", "pipe"]
  };
  function jjExec(args) {
    return execFileSync("jj", args, jjOpts).trim();
  }
  try {
    const repoBase = repo ? `https://${repo.host}/${repo.owner}/${repo.repo}` : "";
    const coloredParts = jjExec([
      "log",
      "-r",
      "@",
      "--no-graph",
      "--color=always",
      "-T",
      'separate("\\t", if(current_working_copy, label("node working_copy", working_copies)), format_short_change_id(change_id), self.bookmarks(), format_short_commit_id(commit_id))'
    ]).split("\t");
    const [coloredNode, coloredCid, coloredBms, coloredCommit] = coloredParts;
    const plainData = jjExec([
      "log",
      "-r",
      "@",
      "--no-graph",
      "-T",
      'separate("\\t", self.bookmarks().join(","), commit_id.short(8), if(immutable, "true", "false"))'
    ]).split("\t");
    const [plainBms, plainCommit, isImmutable] = plainData;
    currentBookmark = plainBms;
    const bmPart = coloredBms && repoBase && currentBookmark ? osc(`${repoBase}/tree/${encodeURIComponent(currentBookmark.split(",")[0])}`, coloredBms) : coloredBms;
    const commitPart = repoBase && isImmutable === "true" ? osc(`${repoBase}/commit/${plainCommit}`, coloredCommit) : coloredCommit;
    const nodePart = coloredNode ? osc(`file://${encCwd}`, coloredNode) : "";
    const parts = [nodePart, coloredCid, bmPart, commitPart].filter(Boolean);
    vcsInfo = parts.join(" ");
    if (!currentBookmark) {
      try {
        currentBookmark = jjExec([
          "log",
          "-r",
          "latest(ancestors(@-) & bookmarks())",
          "--no-graph",
          "-T",
          'self.bookmarks().join(",")'
        ]);
      } catch {}
    }
    currentBookmark = currentBookmark.split(",")[0];
  } catch {
    try {
      const branch = execFileSync("git", ["branch", "--show-current"], {
        cwd,
        encoding: "utf-8",
        timeout: 3000
      }).trim();
      const shortHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd,
        encoding: "utf-8",
        timeout: 3000
      }).trim();
      vcsInfo = [branch, shortHash].filter(Boolean).join(" ");
      currentBookmark = branch;
    } catch {}
  }
  const ctx = input.context_window;
  const modelName = input.model?.display_name ?? "";
  const usageUrl = "https://claude.ai/settings/usage";
  const barParts = [];
  const barWidth = 10;
  function formatRemaining(resetsAtSec) {
    const ms = Math.max(0, resetsAtSec * 1000 - Date.now());
    const totalM = Math.floor(ms / 60000);
    const m = totalM % 60;
    const totalH = Math.floor(totalM / 60);
    const h = totalH % 24;
    const d = Math.floor(totalH / 24);
    const pp = (n) => String(n).padStart(2, "0");
    if (d > 0)
      return `${d}d${pp(h)}h`;
    if (totalH >= 10)
      return `${pp(totalH)}h${pp(m)}m`;
    if (totalH >= 1)
      return `${totalH}h${pp(m)}m`;
    return `${pp(totalM)}m`;
  }
  function dualInfo(util, elapsed, resetsAtSec) {
    const TU = util >= 80 ? "196" : util >= 50 ? "220" : "40";
    const BU = "39";
    const BA = "24";
    const rst = "\x1B[0m";
    return ` \x1B[38;5;${TU}m${util}%${rst}/\x1B[38;5;${BU}m${Math.round(elapsed)}%${rst}/\x1B[38;5;${BA}m${formatRemaining(resetsAtSec)}${rst}`;
  }
  const ctxPct = Math.round(ctx?.used_percentage ?? 0);
  barParts.push(`${osc(usageUrl, "\uD83E\uDDE0")} ${contextBar(ctxPct, barWidth)}`);
  const rl = input.rate_limits;
  if (rl?.five_hour && rl?.seven_day) {
    const f5 = Math.round(rl.five_hour.used_percentage);
    const f5resetsAt = new Date(rl.five_hour.resets_at * 1000).toISOString();
    const f5elapsed = calcElapsed(f5resetsAt, 5);
    barParts.push(`${osc(usageUrl, "\u23F0")} ${dualBar(f5, f5elapsed, barWidth)}${dualInfo(f5, f5elapsed, rl.five_hour.resets_at)}`);
    const f7 = Math.round(rl.seven_day.used_percentage);
    const f7resetsAt = new Date(rl.seven_day.resets_at * 1000).toISOString();
    const f7elapsed = calcElapsed(f7resetsAt, 7 * 24);
    barParts.push(`${osc(usageUrl, "\uD83D\uDCC6")} ${dualBar(f7, f7elapsed, barWidth)}${dualInfo(f7, f7elapsed, rl.seven_day.resets_at)}`);
  }
  if (modelName)
    barParts.push(modelName);
  const barsLine = barParts.join(" | ");
  let prLine = "";
  try {
    let branch = currentBookmark.split(",")[0];
    if (!branch) {
      try {
        branch = execFileSync("git", ["branch", "--show-current"], {
          cwd,
          encoding: "utf-8",
          timeout: 3000
        }).trim();
      } catch {}
    }
    if (branch) {
      const prJson = execFileSync("gh", ["pr", "view", branch, "--json", "number,title,statusCheckRollup"], { cwd, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
      const pr = JSON.parse(prJson);
      if (pr?.number) {
        const red = "\x1B[31m";
        const green = "\x1B[32m";
        const rst = "\x1B[0m";
        const prUrl = repo ? `https://${repo.host}/${repo.owner}/${repo.repo}/pull/${pr.number}` : "";
        const numPart = prUrl ? osc(prUrl, `#${pr.number}`) : `#${pr.number}`;
        const titlePart = prUrl ? osc(prUrl, pr.title) : pr.title;
        let checksStr = "";
        const checks = pr.statusCheckRollup ?? [];
        if (checks.length > 0) {
          const total = checks.length;
          const failed = checks.filter((c) => c.conclusion === "FAILURE" || c.conclusion === "ERROR" || c.conclusion === "CANCELLED");
          const pass = checks.filter((c) => c.conclusion === "SUCCESS").length;
          const parts = [];
          if (failed.length > 0) {
            const failNames = failed.map((c) => {
              const name = c.name ?? c.context ?? "unknown";
              const url = c.detailsUrl ?? c.targetUrl ?? "";
              return url ? osc(url, name) : name;
            });
            parts.push(`${red}${failed.length}${rst}(${failNames.join(", ")})`);
          }
          if (pass > 0)
            parts.push(`${green}${pass}${rst}`);
          checksStr = ` ${parts.join("+")}=${total}`;
        }
        prLine = `${numPart} ${titlePart}${checksStr}`;
      }
    }
  } catch {}
  const lines = [];
  if (barsLine)
    lines.push(barsLine);
  const locationParts = [locationLine, vcsInfo].filter(Boolean);
  lines.push(locationParts.join(" "));
  if (prLine)
    lines.push(prLine);
  process.stdout.write(lines.join(`
`));
}

// src/sample.ts
var WINDOW_HOURS = { "5h": 5, "7d": 7 * 24 };
function divide(range, n) {
  const step = (range[1] - range[0]) / n;
  return Array.from({ length: n + 1 }, (_, i) => Math.round(range[0] + step * i));
}
function interpolate(range, count) {
  if (count <= 1)
    return [range[0]];
  return Array.from({ length: count }, (_, i) => Math.round(range[0] + i / (count - 1) * (range[1] - range[0])));
}
function pad(vals, len) {
  const out = [...vals];
  while (out.length < len)
    out.push(out[out.length - 1]);
  return out;
}
function formatRemaining(elapsedPct, windowHours) {
  const remainMs = Math.max(0, (1 - elapsedPct / 100) * windowHours * 3600000);
  const totalM = Math.floor(remainMs / 60000);
  const m = totalM % 60;
  const totalH = Math.floor(totalM / 60);
  const h = totalH % 24;
  const d = Math.floor(totalH / 24);
  const pp = (n) => String(n).padStart(2, "0");
  if (d > 0)
    return `${d}d${pp(h)}h`;
  if (totalH >= 10)
    return `${pp(totalH)}h${pp(m)}m`;
  if (totalH >= 1)
    return `${totalH}h${pp(m)}m`;
  return `${pp(totalM)}m`;
}
function visibleLength(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07/g, "").length;
}
function renderCols(specs, allPrimary, totalRows, row) {
  const BAR_WIDTH = 10;
  const cols = [];
  for (let si = 0;si < specs.length; si++) {
    const spec = specs[si];
    const util = pad(allPrimary[si], totalRows)[row];
    if (spec.type === "ctx") {
      cols.push(`\uD83E\uDDE0 ${contextBar(util, BAR_WIDTH)}`);
    } else {
      const elapsedVals = spec.elapsed ? interpolate(spec.elapsed, totalRows) : pad([0], totalRows);
      const elapsed = elapsedVals[row];
      const emoji = spec.type === "5h" ? "\u23F0" : "\uD83D\uDCC6";
      const TU = util >= 80 ? "196" : util >= 50 ? "220" : "40";
      const rst = "\x1B[0m";
      const remaining = formatRemaining(elapsed, WINDOW_HOURS[spec.type]);
      cols.push(`${emoji} ${dualBar(util, elapsed, BAR_WIDTH)} \x1B[38;5;${TU}m${util}%${rst}/\x1B[38;5;39m${elapsed}%${rst}/\x1B[38;5;24m${remaining}${rst}`);
    }
  }
  return cols;
}
function runSample(args) {
  const defaultArgs = ["10", "ctx", "0-100", "5h", "0-30/0-100", "7d", "0-80/0-30"];
  if (args.includes("--help") || args.length === 0) {
    console.log(`Usage: kawaz-claude-statusline sample [<n> <type> <range> ...]

Without arguments, shows default sample chart.

Arguments:
  n              Number of divisions (e.g. 4 for 0-100 produces 0,25,50,75,100)
  type           Bar type: ctx (context), 5h (5-hour), 7d (7-day)
  range          from-to[/elapsed-from-to] (e.g. 0-100, 0-100/20-50)

Examples:
  kawaz-claude-statusline sample
  kawaz-claude-statusline sample 10 ctx 0-100
  kawaz-claude-statusline sample 4 ctx 0-100 5h 0-100/20-50 7d 50-80/20-30

\x1B[2m# kawaz-claude-statusline sample ${defaultArgs.join(" ")}\x1B[0m`);
  }
  const effectiveArgs = args.length === 0 || args.includes("--help") ? defaultArgs : args;
  if (effectiveArgs.length < 3 || effectiveArgs.length % 2 === 0) {
    console.log("Usage: kawaz-claude-statusline sample [<n> <type> <range> ...]");
    return;
  }
  const n = parseInt(effectiveArgs[0]);
  if (n <= 0 || isNaN(n)) {
    console.error("n must be a positive integer");
    process.exit(1);
  }
  const specs = [];
  for (let i = 1;i < effectiveArgs.length; i += 2) {
    const type = effectiveArgs[i];
    const parts = effectiveArgs[i + 1].split("/");
    const [a, b] = parts[0].split("-").map(Number);
    const elapsed = parts[1] ? parts[1].split("-").map(Number) : undefined;
    specs.push({ type, range: [a, b], elapsed });
  }
  const allPrimary = specs.map((s) => divide(s.range, n));
  const totalRows = Math.max(...allPrimary.map((v) => v.length));
  const rows = Array.from({ length: totalRows }, (_, r) => renderCols(specs, allPrimary, totalRows, r));
  const colWidths = specs.map((_, ci) => Math.max(...rows.map((r) => visibleLength(r[ci]))));
  for (const row of rows) {
    const padded = row.map((col, ci) => col + " ".repeat(colWidths[ci] - visibleLength(col)));
    console.log(padded.join(" | "));
    console.log();
  }
}

// src/token.ts
import { execFileSync as execFileSync2 } from "child_process";
import { readdirSync } from "fs";
var red = (s) => `\x1B[31m${s}\x1B[0m`;
var green = (s) => `\x1B[32m${s}\x1B[0m`;
var dim = (s) => `\x1B[2m${s}\x1B[0m`;
function formatRemaining2(expiresAt, now) {
  const ms = Math.max(0, expiresAt - (now ?? Date.now()));
  if (ms <= 0)
    return red("expired");
  const totalM = Math.floor(ms / 60000);
  const m = totalM % 60;
  const totalH = Math.floor(totalM / 60);
  const h = totalH % 24;
  const d = Math.floor(totalH / 24);
  const pp = (n) => String(n).padStart(2, "0");
  if (d > 0)
    return green(`${d}d${pp(h)}h${pp(m)}m`);
  if (totalH >= 1)
    return green(`${h}h${pp(m)}m`);
  return green(`${pp(totalM)}m${pp(Math.floor(ms % 60000 / 1000))}s`);
}
function parseTarget(target) {
  const m = target.match(/^(CC|ST):(.+)$/);
  if (!m) {
    console.error(`Invalid target format: ${target}`);
    console.error(`Expected <TYPE>:<CLAUDE_CONFIG_DIR> (e.g. CC:/Users/you/.claude)`);
    process.exit(1);
  }
  return { type: m[1], configDir: m[2] };
}
function discoverKeychainEntries() {
  const home = process.env.HOME ?? "";
  let dump;
  try {
    dump = execFileSync2("security", ["dump-keychain"], {
      encoding: "utf-8",
      timeout: 5000
    });
  } catch {
    return [];
  }
  const servicePattern = /^    "svce"<blob>="(Claude Code-credentials[^"]*)"/gm;
  const services = new Set;
  let match;
  while ((match = servicePattern.exec(dump)) !== null) {
    services.add(match[1]);
  }
  const candidateDirs = [`${home}/.claude`];
  try {
    const dirEntries = readdirSync(home, { withFileTypes: true });
    for (const e of dirEntries) {
      if (e.isDirectory() && e.name.startsWith(".claude-")) {
        candidateDirs.push(`${home}/${e.name}`);
      }
    }
  } catch {}
  for (const pe of readPathEntries()) {
    if (pe.path && !candidateDirs.includes(pe.path)) {
      candidateDirs.push(pe.path);
    }
  }
  const envConfigDir = process.env.CLAUDE_CONFIG_DIR;
  if (envConfigDir && !candidateDirs.includes(envConfigDir)) {
    candidateDirs.push(envConfigDir);
  }
  const entries = [];
  const matched = new Set;
  for (const dir of candidateDirs) {
    const hash = configDirToHash(dir);
    for (const type of ["CC", "ST"]) {
      const svc = configDirToService(dir, type);
      if (services.has(svc)) {
        entries.push({ configDir: dir, hash, service: svc, type });
        matched.add(svc);
      }
    }
  }
  for (const svc of services) {
    if (matched.has(svc))
      continue;
    const isST = svc.endsWith("-ST");
    const type = isST ? "ST" : "CC";
    const hashMatch = svc.match(/^Claude Code-credentials-([a-f0-9]{8})(?:-ST)?$/);
    const hash = hashMatch ? hashMatch[1] : "";
    entries.push({ configDir: "(unknown)", hash, service: svc, type });
  }
  return entries;
}
function tokenHelp() {
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
function expandConfigDir(dir) {
  const home = process.env.HOME ?? "";
  if (dir.startsWith("~/"))
    return `${home}${dir.slice(1)}`;
  return dir;
}
function tokenList() {
  const entries = discoverKeychainEntries();
  if (entries.length === 0) {
    console.log("No Claude Code credential entries found in Keychain.");
    return;
  }
  const groups = new Map;
  for (const e of entries) {
    const key = e.configDir;
    if (!groups.has(key))
      groups.set(key, { hash: e.hash });
    const g = groups.get(key);
    if (e.type === "CC")
      g.cc = e;
    else
      g.st = e;
  }
  const dirWidth = Math.max(20, ...Array.from(groups.keys()).map((k) => k.length));
  const colWidth = 16;
  const header = [
    "CLAUDE_CONFIG_DIR".padEnd(dirWidth),
    "HASH".padEnd(8),
    "CC".padEnd(colWidth),
    "ST".padEnd(colWidth)
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
      stStr.padEnd(colWidth)
    ].join("  ");
    console.log(line);
  }
}
function getEntryTimeStr(entry) {
  if (!entry)
    return "-";
  const creds = readKeychain(entry.service);
  if (!creds?.claudeAiOauth?.expiresAt)
    return "-";
  const expiresAt = creds.claudeAiOauth.expiresAt;
  if (Date.now() >= expiresAt)
    return red("expired");
  return new Date(expiresAt).toISOString().slice(0, 16);
}
function tokenGet(args) {
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
    const token = oauth.accessToken;
    const preview = token.length > 20 ? `${token.slice(0, 15)}...${token.slice(-4)}` : token;
    console.log(`Token:        ${preview} (len=${token.length})`);
  } else {
    console.log(`Token:        ${red("(empty)")}`);
  }
  if (oauth.expiresAt) {
    const d = new Date(oauth.expiresAt);
    console.log(`Expires At:   ${d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "")}`);
    console.log(`Remaining:    ${formatRemaining2(oauth.expiresAt)}`);
  }
  if (oauth.refreshToken) {
    const rt = oauth.refreshToken;
    const preview = rt.length > 20 ? `${rt.slice(0, 15)}...${rt.slice(-4)}` : rt;
    console.log(`Refresh:      ${preview} (len=${rt.length})`);
  }
  if (oauth.refreshTokenExpiresAt) {
    const rd = new Date(oauth.refreshTokenExpiresAt);
    console.log(`RT Expires:   ${rd.toISOString().replace("T", " ").replace(/\.\d+Z$/, "")}`);
    console.log(`RT Remaining: ${formatRemaining2(oauth.refreshTokenExpiresAt)}`);
  }
}
function tokenDelete(args) {
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
      execFileSync2("security", ["delete-generic-password", "-s", service, "-a", account], {
        encoding: "utf-8",
        timeout: 5000
      });
      console.log(`Deleted: ${service}`);
    } catch {
      console.error(`Failed to delete: ${service} (may not exist)`);
    }
  }
}
function tokenRefresh(args) {
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
      expiresAt: result.expiresAt
    };
    if (result.refreshTokenExpiresAt) {
      creds.claudeAiOauth.refreshTokenExpiresAt = result.refreshTokenExpiresAt;
    }
    writeKeychain(service, creds);
    console.log(`Refreshed: ${service} (expires in ${formatRemaining2(result.expiresAt)})`);
  }
}
function tokenSet(args) {
  if (args.length < 2) {
    console.error("Usage: kawaz-claude-statusline token set <target> <json>");
    process.exit(1);
  }
  const { type, configDir: rawDir } = parseTarget(args[0]);
  const configDir = expandConfigDir(rawDir);
  const service = configDirToService(configDir, type);
  const jsonStr = args.slice(1).join(" ");
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`Invalid JSON: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
  writeKeychain(service, parsed);
  console.log(`Set: ${service}`);
}
function tokenCp(args) {
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
function runToken(args) {
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

// src/cli.ts
var args = process.argv.slice(2);
var cmd = args[0];
function help() {
  console.log(`Usage: kawaz-claude-statusline <command> [options]

Commands:
  run       Output statusbar (reads JSON from stdin)
  token     Manage OAuth credential entries in Keychain
  register  Register statusLine.command in ~/.claude/settings.json
  sample    Visualize bars with sample data

Run 'kawaz-claude-statusline <command> --help' for more information on a command.`);
}
function register(regArgs) {
  const force = regArgs.includes("--force");
  if (regArgs.includes("--help")) {
    console.log(`Usage: kawaz-claude-statusline register [--force]

Register statusLine.command in ~/.claude/settings.json.

Options:
  --force    Overwrite existing statusLine setting`);
    return;
  }
  const settingsPath = `${process.env.HOME}/.claude/settings.json`;
  let settings = {};
  try {
    settings = JSON.parse(readFileSync2(settingsPath, "utf-8"));
  } catch {}
  if (settings.statusLine && !force) {
    console.error("");
    console.error("statusLine is already configured in ~/.claude/settings.json:");
    console.error(`  ${JSON.stringify(settings.statusLine)}`);
    console.error("");
    console.error("Use --force to overwrite.");
    process.exit(1);
  }
  const scriptPath = process.argv[1];
  const command = `bun ${scriptPath} run`;
  settings.statusLine = {
    type: "command",
    command
  };
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + `
`);
  console.log(`Registered in ${settingsPath}:`);
  console.log(`  statusLine.command = "${command}"`);
}
switch (cmd) {
  case "register":
    register(args.slice(1));
    break;
  case "run":
    if (args.includes("--help") || isatty(0)) {
      console.log(`Usage: kawaz-claude-statusline run

Reads JSON from stdin (provided by Claude Code) and outputs multi-line
status display with context window, usage bars (5h/7d), VCS info, and PR.

Credentials:
  Uses dedicated Keychain entry (Claude Code-credentials-ST).
  On first run, seeded from Claude Code's entry.
  Refreshes independently via own token chain.

Caching:
  API responses cached for 6 minutes.
  On API failure, stale cache returned as fallback.`);
      break;
    }
    runStatusbar();
    break;
  case "token":
    runToken(args.slice(1));
    break;
  case "sample":
    runSample(args.slice(1));
    break;
  case "--help":
  case undefined:
    help();
    break;
  default:
    console.error(`Unknown command: ${cmd}`);
    console.error("");
    help();
    process.exit(1);
}
