#!/usr/bin/env bun
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, statSync } from "fs";

const input = JSON.parse(readFileSync("/dev/stdin", "utf-8"));
const home = process.env.HOME ?? "";
const cwd: string = input.workspace?.current_dir ?? "";

// OSC 8 hyperlink: clickable in terminals that support it
function osc(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

// --- Line 1: Path or Repo ---
function parseRepo(dir: string): { host: string; owner: string; repo: string } | null {
  const m = dir.match(/\/repos\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { host: m[1], owner: m[2], repo: m[3] };
}

const repo = parseRepo(cwd);
const finderLink = osc(`file://${cwd}`, "📂");
let locationLine: string;
if (repo) {
  const ownerUrl = `https://${repo.host}/${repo.owner}`;
  const repoUrl = `https://${repo.host}/${repo.owner}/${repo.repo}`;
  locationLine = `${finderLink} ${osc(ownerUrl, repo.owner)}/${osc(repoUrl, repo.repo)}`;
} else {
  locationLine = osc(`file://${cwd}`, cwd);
}

// VCS: try jj (change_id + bookmarks/distance, colored), fall back to git
let vcsInfo = "";
let currentBookmark = "";
const jjOpts = { cwd, encoding: "utf-8" as const, timeout: 3000, stdio: ["pipe", "pipe", "pipe"] as const };
function jjExec(args: string[]): string {
  return execFileSync("jj", args, jjOpts).trim();
}
try {
  const repoBase = repo ? `https://${repo.host}/${repo.owner}/${repo.repo}` : "";

  // Get colored parts + plain data in two jj calls
  const coloredParts = jjExec(["log", "-r", "@", "--no-graph", "--color=always",
    "-T", 'separate("\\t", if(current_working_copy, label("node working_copy", "@")), format_short_change_id(change_id), self.bookmarks(), format_short_commit_id(commit_id))']).split("\t");
  const [coloredNode, coloredCid, coloredBms, coloredCommit] = coloredParts;
  const plainData = jjExec(["log", "-r", "@", "--no-graph",
    "-T", 'separate("\\t", self.bookmarks().join(","), commit_id.short(8), if(immutable, "true", "false"))']).split("\t");
  const [plainBms, plainCommit, isImmutable] = plainData;
  currentBookmark = plainBms;

  // Links: bookmark→branch, commit→commit (only if immutable/pushed)
  const bmPart = coloredBms && repoBase && currentBookmark
    ? osc(`${repoBase}/tree/${currentBookmark.split(",")[0]}`, coloredBms)
    : coloredBms;
  const commitPart = repoBase && isImmutable === "true"
    ? osc(`${repoBase}/commit/${plainCommit}`, coloredCommit)
    : coloredCommit;

  const parts = [coloredNode, coloredCid, bmPart, commitPart].filter(Boolean);
  vcsInfo = parts.join(" ");

  if (!currentBookmark) {
    try {
      currentBookmark = jjExec(["log", "-r", "latest(ancestors(@-) & bookmarks())", "--no-graph", "-T", 'self.bookmarks().join(",")']);
    } catch {}
  }
  currentBookmark = currentBookmark.split(",")[0];
} catch {
  // Fall back to git
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd, encoding: "utf-8", timeout: 3000,
    }).trim();
    const shortHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd, encoding: "utf-8", timeout: 3000,
    }).trim();
    vcsInfo = [branch, shortHash].filter(Boolean).join(" ");
    currentBookmark = branch;
  } catch {}
}

// --- Line 3: Bars (context + 5h + 1w) + Model ---
const ctx = input.context_window;
const modelName = input.model?.display_name ?? "";

// --- Line 4: Claude API usage (5h / 1w) ---
const CACHE_FILE = "/tmp/claude-usage-cache.json";
const CACHE_TTL = 360;

function getUsageData(): Record<string, any> | null {
  try {
    const stat = statSync(CACHE_FILE);
    if ((Date.now() - stat.mtimeMs) / 1000 < CACHE_TTL) {
      return JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
    }
  } catch {}

  try {
    const credsRaw = execFileSync(
      "security",
      ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
      { encoding: "utf-8", timeout: 3000 },
    );
    const creds = JSON.parse(credsRaw);
    const token = creds?.claudeAiOauth?.accessToken;
    if (!token) return null;

    const res = execFileSync("curl", [
      "-sf", "--max-time", "5",
      "-H", `Authorization: Bearer ${token}`,
      "-H", "anthropic-beta: oauth-2025-04-20",
      "https://api.anthropic.com/api/oauth/usage",
    ], { encoding: "utf-8", timeout: 10000 });

    const data = JSON.parse(res);
    if (!data.five_hour) return null;
    writeFileSync(CACHE_FILE, JSON.stringify(data));
    return data;
  } catch {
    return null;
  }
}

function colorize(text: string, util: number): string {
  const code = util >= 80 ? 31 : util >= 50 ? 33 : 32;
  return `\x1b[${code}m${text}\x1b[0m`;
}

function formatResetInfo(resetsAt: string, windowLabel: string, windowHours: number): string {
  const reset = new Date(resetsAt);
  if (isNaN(reset.getTime())) return "";

  const now = new Date();
  const windowMs = windowHours * 3600_000;
  const elapsedMs = Math.max(0, now.getTime() - (reset.getTime() - windowMs));

  // Remaining time (1 decimal)
  const remainingMs = Math.max(0, reset.getTime() - now.getTime());
  let remaining: string;
  if (windowHours >= 24) {
    remaining = `${(remainingMs / 3600_000 / 24).toFixed(1)}d`;
  } else {
    remaining = `${(remainingMs / 3600_000).toFixed(1)}h`;
  }

  // Reset time in JST (24h format)
  const timeFmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const timePart = timeFmt.format(reset);

  // Check if today in JST
  const dateFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const isToday = dateFmt.format(reset) === dateFmt.format(now);

  let resetAt: string;
  if (isToday) {
    resetAt = timePart;
  } else {
    const dowFmt = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      weekday: "short",
    });
    resetAt = `${dowFmt.format(reset)}${timePart}`;
  }

  const bright = "\x1b[38;5;39m";  // timeColor
  const dim = "\x1b[38;5;24m";     // timeDim
  const rst = "\x1b[0m";
  return ` ${bright}${remaining}${rst}[${resetAt}]`;
}

// Dual-bar: top=utilization, bottom=time elapsed in window
// Always use ▀ with fg=top color, bg=bottom color (gray for empty)
/*
 * ========================================================================
 * Dual Bar Design: Quadrant-based rendering
 * ========================================================================
 *
 * ## Terminology
 *   U = Use (filled)    A = Avail (empty)
 *   T = Top             B = Bottom
 *   L = Left            R = Right
 *   b = bar (prefix)    t = text (prefix)
 *
 * ## Bar color aliases
 *   TU = barTopUse      — utilColor (196/220/40)
 *   TA = barTopAvail    — gray ("240")
 *   BU = barBottomUse   — timeColor ("39")
 *   BA = barBottomAvail — timeDim ("24")
 *
 * ## Text color aliases
 *   tU = textInUsage — black (16). ctx bar の%表示専用
 *   tA = textInAvail — dual bar の 5h/7d ラベル用。常に tA、黒にはならない
 *
 * ## Quadrant characters (fixed)
 *   cAAAA=' '    cAAUA='▖'    cAAUU='▄'
 *   cUAAA='▘'    cUAUA='▌'    cUAUU='▙'
 *   cUUAA='▀'    cUUUA='▛'    cUUUU='█'
 *
 *   Pattern = TL TR BL BR — valid states per bar: AA, UA, UU (3×3=9)
 *
 * ## State table: [char, bf, bg, tf, tb]
 *   tf/tb = text foreground/background (5h/7d label, always tA style)
 *
 *   Derivation rules:
 *     Top ∈ {UA,UU} → tf=TU  tb=BA
 *     Top = AA       → bottom=AA:      tf=白  tb=TA
 *                      bottom∈{UA,UU}: tf=BU  tb=TA
 *
 *   State  char    bf  bg  tf  tb   Notes
 *   ───── ─────── ─── ─── ─── ───  ──────────────────────
 *   AAAA  cUUAA   TA  BA  白  TA   ▀ で上下区別を維持
 *   AAUA  cAAUA   BU  BA  BU  TA   bottom=boundary
 *   AAUU  cAAUU   BU  TA  BU  TA
 *   UAAA  cUAAA   TU  BA  TU  BA   top=boundary
 *   UAUA  cUAAA   TU  BA  TU  BA   2色制限: top優先
 *   UAUU  cAAUU   BU  TA  TU  BA   2色制限: bottom優先
 *   UUAA  cUUAA   TU  BA  TU  BA
 *   UUUA  cUUAA   TU  BU  TU  BA   2色制限: top優先
 *   UUUU  cUUAA   TU  BU  TU  BA
 *
 *   Color constraint: each cell has only fg + bg (2 colors).
 *   Conflict cells (UAUA, UAUU, UUUA) need compromise — one bar's
 *   boundary is sacrificed. Priority: top bar for UAUA/UUUA,
 *   bottom bar for UAUU.
 *
 * ========================================================================
 */
function dualBar(util: number, elapsed: number, width: number, text?: string): string {
  // Half-cell resolution: 2 half-cells per cell → doubled precision
  const utilHalf = Math.round((util / 100) * width * 2);
  const elapHalf = Math.round((elapsed / 100) * width * 2);
  const rst = "\x1b[0m";

  // Color aliases (see design comment above)
  const TU = util >= 80 ? "196" : util >= 50 ? "220" : "40";
  const TA = "240";
  const BU = "39";
  const BA = "24";
  const tW = "231";  // white (text on empty bars)

  // Half-state for a bar at cell i: "AA" | "UA" | "UU"
  const half = (i: number, h: number) =>
    2 * i + 1 < h ? "UU" : 2 * i < h ? "UA" : "AA";

  // State table: [char, bf, bg, tf, tb]
  //   tf/tb = text colors for 5h/7d label (always tA style, never black)
  type E = [string, string, string, string, string];
  const S: Record<string, E> = {
    AAAA: ["▀", TA, BA, tW, TA],
    AAUA: ["▖", BU, BA, BU, TA],
    AAUU: ["▄", BU, TA, BU, TA],
    UAAA: ["▘", TU, BA, TU, BA],
    UAUA: ["▘", TU, BA, TU, BA],
    UAUU: ["▄", BU, TA, TU, BA],
    UUAA: ["▀", TU, BA, TU, BA],
    UUUA: ["▀", TU, BU, TU, BA],
    UUUU: ["▀", TU, BU, TU, BA],
  };

  const bucketStart = text ? width - text.length - 1 : width;

  // Hide text entirely when top bar reaches any text cell
  let showText = !!text;
  if (text) {
    for (let i = bucketStart; i < bucketStart + text.length; i++) {
      if (half(i, utilHalf) !== "AA") { showText = false; break; }
    }
  }

  let bar = "";
  for (let i = 0; i < width; i++) {
    const state = half(i, utilHalf) + half(i, elapHalf);
    const s = S[state] ?? S.AAAA;
    const [ch, bf, bg, tf, tb] = s;

    if (showText && i >= bucketStart && i < bucketStart + text!.length) {
      bar += `\x1b[1m\x1b[38;5;${tf}m\x1b[48;5;${tb}m${text![i - bucketStart]}`;
    } else {
      bar += `\x1b[38;5;${bf}m\x1b[48;5;${bg}m${ch}`;
    }
  }
  return bar + rst;
}

function calcElapsed(resetsAt: string, windowHours: number): number {
  const reset = new Date(resetsAt);
  if (isNaN(reset.getTime())) return 0;
  const now = Date.now();
  const windowMs = windowHours * 3600_000;
  const windowStart = reset.getTime() - windowMs;
  const elapsed = ((now - windowStart) / windowMs) * 100;
  return Math.max(0, Math.min(100, elapsed));
}

// Build unified bars line: ctx + 5h + 1w + model
const usageUrl = "https://claude.ai/settings/usage";
const barParts: string[] = [];
const barWidth = 10;

if (ctx?.used_percentage != null) {
  const pct = Math.round(ctx.used_percentage);
  const ctxColor = pct >= 80 ? "196" : pct >= 50 ? "220" : "40";
  const ctxGray = pct >= 80 ? "52" : pct >= 50 ? "58" : "22";  // dim red / dim yellow / dim green
  // barWidth=10 → each cell=10%. Use floor for full cells, ones digit for partial.
  const fullCells = Math.floor(pct / 10);
  const onesDigit = pct % 10;
  const blockChars = " ▏▎▍▌▋▊▉█";
  const partialChar = blockChars[Math.round(onesDigit * 8 / 9)] ?? "█";
  const ctxText = `${pct}%`;
  // Mode switch: ones 7-9 count partial cell as filled for Avail→Usage threshold
  const effectiveFilled = onesDigit >= 7 ? fullCells + 1 : fullCells;
  let ctxTextStart: number;
  if (effectiveFilled >= Math.ceil(barWidth / 2)) {
    // Usage mode: center using fractional visual width
    const visualWidth = fullCells + Math.max(0, onesDigit - 1) / blockChars.length;
    ctxTextStart = Math.round((visualWidth - ctxText.length) / 2);
    if (ctxTextStart < 0) ctxTextStart = 0;
  } else {
    ctxTextStart = barWidth - ctxText.length - 1;
  }
  let ctxBar = "";
  for (let i = 0; i < barWidth; i++) {
    const isFull = i < fullCells;
    const isPartial = i === fullCells && onesDigit > 0;
    if (i >= ctxTextStart && i < ctxTextStart + ctxText.length) {
      if (isFull || isPartial) {
        ctxBar += `\x1b[0m\x1b[1m\x1b[30m\x1b[48;5;${ctxColor}m${ctxText[i - ctxTextStart]}`;
      } else {
        ctxBar += `\x1b[0m\x1b[1m\x1b[38;5;${ctxColor}m\x1b[48;5;${ctxGray}m${ctxText[i - ctxTextStart]}`;
      }
    } else if (isPartial) {
      // Partial block: fg=ctxColor (block), bg=gray (empty above)
      ctxBar += `\x1b[0m\x1b[38;5;${ctxColor}m\x1b[48;5;${ctxGray}m${partialChar}`;
    } else {
      ctxBar += `\x1b[0m\x1b[48;5;${isFull ? ctxColor : ctxGray}m `;
    }
  }
  ctxBar += "\x1b[0m";
  barParts.push(`${osc(usageUrl, "🧠")} ${ctxBar}`);
}

const usage = getUsageData();
if (usage?.five_hour && usage?.seven_day) {
  const f5 = Math.round(usage.five_hour.utilization);
  const f5elapsed = calcElapsed(usage.five_hour.resets_at, 5);
  barParts.push(`${osc(usageUrl, "⏰")} ${dualBar(f5, f5elapsed, barWidth, "5h")}${formatResetInfo(usage.five_hour.resets_at, "5h", 5)}`);

  const f7 = Math.round(usage.seven_day.utilization);
  const f7elapsed = calcElapsed(usage.seven_day.resets_at, 7 * 24);
  barParts.push(`${osc(usageUrl, "📆")} ${dualBar(f7, f7elapsed, barWidth, "7d")}${formatResetInfo(usage.seven_day.resets_at, "7d", 7 * 24)}`);
}

if (modelName) barParts.push(modelName);
const barsLine = barParts.join(" | ");

// --- Line 5: PR (with title and checks) ---
let prLine = "";
try {
  // Use jj bookmark (already fetched), fall back to git branch
  let branch = currentBookmark.split(",")[0];
  if (!branch) {
    try {
      branch = execFileSync("git", ["branch", "--show-current"], {
        cwd, encoding: "utf-8", timeout: 3000,
      }).trim();
    } catch {}
  }
  if (branch) {
    const prJson = execFileSync("gh", [
      "pr", "view", branch,
      "--json", "number,title,statusCheckRollup",
    ], { cwd, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    const pr = JSON.parse(prJson);
    if (pr?.number) {
      const red = "\x1b[31m";
      const green = "\x1b[32m";
      const rst = "\x1b[0m";

      const prUrl = repo
        ? `https://${repo.host}/${repo.owner}/${repo.repo}/pull/${pr.number}`
        : "";

      // #NNNN and title are separate OSC links to the PR
      const numPart = prUrl ? osc(prUrl, `#${pr.number}`) : `#${pr.number}`;
      const titlePart = prUrl ? osc(prUrl, pr.title) : pr.title;

      // Check status
      let checksStr = "";
      const checks: any[] = pr.statusCheckRollup ?? [];
      if (checks.length > 0) {
        const total = checks.length;

        // Failed checks: each name is an OSC link to its detail page
        const failed = checks.filter((c: any) =>
          c.conclusion === "FAILURE" || c.conclusion === "ERROR" || c.conclusion === "CANCELLED"
        );
        const pass = checks.filter((c: any) => c.conclusion === "SUCCESS").length;

        const parts: string[] = [];
        if (failed.length > 0) {
          const failNames = failed.map((c: any) => {
            const name = c.name ?? c.context ?? "unknown";
            const url = c.detailsUrl ?? c.targetUrl ?? "";
            return url ? osc(url, name) : name;
          });
          parts.push(`${red}${failed.length}${rst}(${failNames.join(", ")})`);
        }
        if (pass > 0) parts.push(`${green}${pass}${rst}`);
        checksStr = ` ${parts.join("+")}=${total}`;
      }

      prLine = `${numPart} ${titlePart}${checksStr}`;
    }
  }
} catch {}

// --- Output (bars first, then text lines below for natural gap above text) ---
const lines: string[] = [];
if (barsLine) lines.push(barsLine);
const locationParts = [locationLine, vcsInfo].filter(Boolean);
lines.push(locationParts.join(" "));
if (prLine) lines.push(prLine);
process.stdout.write(lines.join("\n"));
