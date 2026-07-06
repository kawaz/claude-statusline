import { execFileSync } from "child_process";
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { ansi } from "./ansi";
import { calcElapsed, contextBar, dualBar, formatDuration, utilColor } from "./bar";

function encPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function parseRepo(dir: string): { host: string; owner: string; repo: string } | null {
  const m = dir.match(/\/repos\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { host: m[1], owner: m[2], repo: m[3] };
}

// PR cache: `gh pr view` dominates latency (~620ms); TTL-cache via file.
// See docs/decisions/DR-0001-gh-pr-cache.md.
const PR_CACHE_TTL_MS = 60_000;

function prCachePath(repo: { host: string; owner: string; repo: string }, branch: string): string {
  const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "_");
  return join(
    base,
    "claude-statusline",
    "pr",
    `${safe(repo.host)}-${safe(repo.owner)}-${safe(repo.repo)}-${safe(branch)}.json`,
  );
}

function loadPrCache(path: string): unknown {
  try {
    const st = statSync(path);
    if (Date.now() - st.mtimeMs > PR_CACHE_TTL_MS) return null;
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function savePrCache(path: string, data: unknown): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(data));
  } catch {}
}

type ClaudeAgent = {
  pid: number;
  sessionId: string;
  status: string;
  startedAt: number;
};

function ancestorPids(): Set<number> {
  const set = new Set<number>();
  let pid = process.ppid;
  let depth = 0;
  while (pid && pid !== 1 && depth < 16) {
    set.add(pid);
    try {
      const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      const next = Number(out);
      if (!next || next === pid) break;
      pid = next;
    } catch {
      break;
    }
    depth++;
  }
  return set;
}

type SessionEntry = ClaudeAgent & { self: boolean };

function listSessionInstances(sessionId: string): {
  entries: SessionEntry[];
  hasOther: boolean;
} {
  if (!sessionId) return { entries: [], hasOther: false };
  try {
    const out = execFileSync("claude", ["agents", "--json"], {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const list = JSON.parse(out) as ClaudeAgent[];
    const same = list.filter((a) => a.sessionId === sessionId);
    const ancestors = ancestorPids();
    const entries: SessionEntry[] = same.map((a) => ({ ...a, self: ancestors.has(a.pid) }));
    entries.sort((a, b) => a.startedAt - b.startedAt);
    return { entries, hasOther: entries.some((e) => !e.self) };
  } catch {
    return { entries: [], hasOther: false };
  }
}

function formatStartedAt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function formatUptime(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}d${h}h${m}m`;
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function isRealUserTurn(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  if (e.type !== "user") return false;
  if (e.isMeta === true) return false;
  if (e.isCompactSummary === true) return false;
  const msg = e.message as { content?: unknown } | undefined;
  if (!msg) return false;
  let text: string;
  if (typeof msg.content === "string") {
    text = msg.content;
  } else if (Array.isArray(msg.content)) {
    text = msg.content
      .filter((b: unknown) => (b as { type?: string })?.type === "text")
      .map((b: unknown) => (b as { text?: string }).text ?? "")
      .join("\n");
  } else {
    return false;
  }
  const trimmed = text.trim();
  if (!trimmed) return false;
  // 先頭が <...> or [...] な system 注入は除外。kawaz は通常そういう発言をしない。
  if (/^[<[]/.test(trimmed)) return false;
  return true;
}

function readLastUserTurnTs(transcriptPath: string): string {
  if (!transcriptPath) return "";
  try {
    const fd = openSync(transcriptPath, "r");
    try {
      const st = fstatSync(fd);
      const size = st.size;
      const chunkSize = Math.min(256 * 1024, size);
      const buf = Buffer.alloc(chunkSize);
      readSync(fd, buf, 0, chunkSize, size - chunkSize);
      const lines = buf.toString("utf-8").split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lines[i]!);
          if (isRealUserTurn(entry)) return entry.timestamp ?? "";
        } catch {}
      }
    } finally {
      closeSync(fd);
    }
  } catch {}
  return "";
}

type StatusbarConfig = { debug: { enabled: boolean } };

function loadStatusbarConfig(): StatusbarConfig {
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? `${homedir()}/.config`;
  try {
    const raw = readFileSync(`${xdgConfig}/claude-statusline/config.json`, "utf-8");
    const loaded = JSON.parse(raw) as Partial<{ debug: Partial<StatusbarConfig["debug"]> }>;
    return { debug: { enabled: loaded.debug?.enabled === true } };
  } catch {
    return { debug: { enabled: false } };
  }
}

// Debug dump dir: $TMPDIR/claude-statusline-<uid>/ で per-user 分離。
// macOS の TMPDIR (/var/folders/.../T/) は既に user 単位だが、Linux の /tmp
// 等共有 dir でも衝突しないよう uid を付ける。
function defaultDebugDir(): string {
  const tmp = process.env.TMPDIR?.replace(/\/$/, "") ?? "/tmp";
  const uid = process.getuid?.() ?? 0;
  return `${tmp}/claude-statusline-${uid}`;
}

const statusbarConfig = loadStatusbarConfig();
const DEBUG_DIR = defaultDebugDir();

function debugDump(suffix: string, content: string): void {
  if (!statusbarConfig.debug.enabled) return;
  try {
    mkdirSync(DEBUG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    writeFileSync(`${DEBUG_DIR}/${ts}-${process.pid}-${suffix}`, content);
  } catch {}
}

export function runStatusbar(): void {
  const raw = readFileSync("/dev/stdin", "utf-8");
  debugDump("input.json", raw);
  if (!raw.trim()) {
    console.error("Error: No input on stdin. This command expects JSON from Claude Code.");
    console.error("Tip: register as Claude Code statusLine first:");
    console.error("  bun run /path/to/src/cli.ts register");
    process.exit(1);
  }
  let input: any;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    console.error(`Error: stdin is not valid JSON: ${(e as Error).message}`);
    process.exit(1);
  }
  const cwd: string = input.workspace?.current_dir ?? "";

  const inputRepo = input.workspace?.repo as
    | { host?: string; owner?: string; name?: string }
    | undefined;
  const repo =
    inputRepo?.host && inputRepo.owner && inputRepo.name
      ? { host: inputRepo.host, owner: inputRepo.owner, repo: inputRepo.name }
      : parseRepo(cwd);
  const encCwd = encPath(cwd);
  const finderLink = ansi.link(`file://${encCwd}`, "📂");
  const vscodeLink = `[${ansi.link(`vscode://file${encCwd}`, "VSCode")}]`;

  // Worktree badge (Claude Code's EnterWorktree state).
  // input.worktree is non-null iff the session is currently inside an EnterWorktree.
  const wt = input.worktree as { name?: string; path?: string } | undefined;
  let wtBadge = "";
  if (wt?.name) {
    const green = ansi.sgr(32);
    const label = `${green}🌿${wt.name}${ansi.reset}`;
    wtBadge = wt.path ? ansi.link(`file://${encPath(wt.path)}`, label) : label;
  }

  // Remote control link (grep transcript for latest URL)
  let remoteLink = "";
  try {
    const transcriptPath: string = input.transcript_path ?? "";
    if (transcriptPath) {
      const url = execFileSync(
        "grep",
        ["-oE", "https://claude.ai/code/session_[a-zA-Z0-9]+", "--", transcriptPath],
        { encoding: "utf-8", timeout: 3000 },
      )
        .trim()
        .split("\n")
        .pop();
      if (url) remoteLink = ` [${ansi.link(url, "Remote")}]`;
    }
  } catch {}

  const wtPart = wtBadge ? ` ${wtBadge}` : "";
  let locationLine: string;
  if (repo) {
    const ownerUrl = `https://${repo.host}/${repo.owner}`;
    const repoUrl = `https://${repo.host}/${repo.owner}/${repo.repo}`;
    const dimBlue = ansi.sgr("2;34");
    const blue = ansi.sgr("34");
    locationLine = `${finderLink}${vscodeLink}${remoteLink} ${dimBlue}${ansi.link(ownerUrl, repo.owner)}${ansi.reset}/${blue}${ansi.link(repoUrl, repo.repo)}${ansi.reset}${wtPart}`;
  } else {
    locationLine =
      `${finderLink}${vscodeLink}${remoteLink} ` + ansi.link(`file://${encCwd}`, cwd) + wtPart;
  }

  // VCS: try jj, fall back to git
  let vcsInfo = "";
  let currentBookmark = "";
  const jjOpts = {
    cwd,
    encoding: "utf-8" as const,
    timeout: 3000,
    stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
  };
  function jjExec(args: string[]): string {
    return execFileSync("jj", args, jjOpts).trim();
  }
  try {
    const repoBase = repo ? `https://${repo.host}/${repo.owner}/${repo.repo}` : "";
    const colorFlag = (process.env.NO_COLOR ?? "") !== "" ? "--color=never" : "--color=always";

    // Single jj log call emits both colored and plain fields, separated by \x1f (US).
    // concat() preserves empty fields (separate() skips them, which misaligns splits).
    const combined = jjExec([
      "log",
      "-r",
      "@",
      "--no-graph",
      colorFlag,
      "-T",
      [
        "concat(",
        'if(current_working_copy, label("node working_copy", working_copies)), "\\x1f",',
        'format_short_change_id(change_id), "\\x1f",',
        'self.bookmarks(), "\\x1f",',
        'format_short_commit_id(commit_id), "\\x1f",',
        'self.bookmarks().join(","), "\\x1f",',
        'commit_id.short(8), "\\x1f",',
        'if(immutable, "true", "false")',
        ")",
      ].join(""),
    ]).split("\x1f");
    const [coloredNode, coloredCid, coloredBms, coloredCommit, plainBms, plainCommit, isImmutable] =
      combined;
    currentBookmark = plainBms;

    const bmPart =
      coloredBms && repoBase && currentBookmark
        ? ansi.link(
            `${repoBase}/tree/${encodeURIComponent(currentBookmark.split(",")[0])}`,
            coloredBms,
          )
        : coloredBms;
    const commitPart =
      repoBase && isImmutable === "true"
        ? ansi.link(`${repoBase}/commit/${plainCommit}`, coloredCommit)
        : coloredCommit;

    const nodePart = coloredNode ? ansi.link(`file://${encCwd}`, coloredNode) : "";
    const parts = [nodePart, coloredCid, bmPart, commitPart].filter(Boolean);
    vcsInfo = parts.join(" ");

    if (!currentBookmark) {
      try {
        currentBookmark = jjExec([
          "log",
          "-r",
          // heads() で topology 上「最も近い」bookmark を選ぶ (latest だけだと
          // timestamp が新しい遠方 bookmark を拾いうる)。merge で複数 head が
          // 残る余地があるため latest() を外側に付けて単一化のタイブレークに使う。
          "latest(heads(ancestors(@-) & bookmarks()))",
          "--no-graph",
          "-T",
          'self.bookmarks().join(",")',
        ]);
      } catch {}
    }
    currentBookmark = currentBookmark.split(",")[0];
  } catch {
    try {
      const gitOpts = {
        cwd,
        encoding: "utf-8" as const,
        timeout: 3000,
        stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
      };
      const branch = execFileSync("git", ["branch", "--show-current"], gitOpts).trim();
      const shortHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], gitOpts).trim();
      const repoBase = repo ? `https://${repo.host}/${repo.owner}/${repo.repo}` : "";
      const greenBold = `${ansi.sgr(1)}${ansi.sgr(32)}`;
      const branchColored = branch ? `${greenBold}${branch}${ansi.reset}` : "";
      const branchPart =
        branchColored && repoBase
          ? ansi.link(`${repoBase}/tree/${encodeURIComponent(branch)}`, branchColored)
          : branchColored;
      vcsInfo = [branchPart, shortHash].filter(Boolean).join(" ");
      currentBookmark = branch;
    } catch {}
  }

  // Bars
  const ctx = input.context_window;
  const rawModel: string = (input.model?.id ?? "").replace(/^claude-/, "");
  const modelName = rawModel
    ? `${ansi.fg(40)}${rawModel.replace(/\[.*/, (s: string) => `${ansi.dim}${ansi.fg(40)}${s}`)}${ansi.reset}`
    : "";

  const usageUrl = "https://claude.ai/settings/usage";
  const barParts: string[] = [];
  const barWidth = 10;

  function dualInfo(util: number, elapsed: number, resetsAtSec: number): string {
    const remaining = formatDuration(resetsAtSec * 1000 - Date.now());
    return `${ansi.fg(utilColor(util))}${util}%${ansi.reset}/${ansi.fg(39)}${Math.round(elapsed)}%${ansi.reset}/${ansi.fg(24)}${remaining}${ansi.reset}`;
  }

  const rl = input.rate_limits;
  if (rl?.five_hour && rl?.seven_day) {
    const f5 = Math.round(rl.five_hour.used_percentage);
    const f5resetsAt = new Date(rl.five_hour.resets_at * 1000).toISOString();
    const f5elapsed = calcElapsed(f5resetsAt, 5);
    barParts.push(
      `${ansi.link(usageUrl, "⏰")}${dualBar(f5, f5elapsed, barWidth)}${dualInfo(f5, f5elapsed, rl.five_hour.resets_at)}`,
    );

    const f7 = Math.round(rl.seven_day.used_percentage);
    const f7resetsAt = new Date(rl.seven_day.resets_at * 1000).toISOString();
    const f7elapsed = calcElapsed(f7resetsAt, 7 * 24);
    barParts.push(
      `${ansi.link(usageUrl, "📆")}${dualBar(f7, f7elapsed, barWidth)}${dualInfo(f7, f7elapsed, rl.seven_day.resets_at)}`,
    );
  }

  const ctxPct = Math.round(ctx?.used_percentage ?? 0);
  barParts.push(`${ansi.link(usageUrl, "🧠")}${contextBar(ctxPct, barWidth)}${modelName}`);

  // Cost: per-turn delta (since last real user submit) + session total + lines diff.
  // Turn boundary = most recent user message in transcript whose text does NOT start with
  // a tag-like prefix (< or [). System-injected entries (system-reminder, task-notification,
  // Request interrupted, etc.) all start with one of those so a single regex filter is enough.
  let costPart = "";
  const cost = input.cost;
  if (cost && typeof cost.total_cost_usd === "number") {
    const sid: string = input.session_id ?? "";
    const cur = cost.total_cost_usd;
    const stateDir = `${homedir()}/.cache/claude-statusline/cost-state`;
    const stateFile = sid ? `${stateDir}/${sid}.json` : "";
    const lastUserTs = readLastUserTurnTs(input.transcript_path ?? "");
    let turnStartCost = cur;
    if (stateFile) {
      let st: { last_user_ts?: string; cost_at_turn_start?: number } | null = null;
      try {
        st = JSON.parse(readFileSync(stateFile, "utf-8"));
      } catch {}
      if (st && st.last_user_ts === lastUserTs && typeof st.cost_at_turn_start === "number") {
        turnStartCost = st.cost_at_turn_start;
      } else {
        try {
          mkdirSync(stateDir, { recursive: true });
          writeFileSync(
            stateFile,
            JSON.stringify({ last_user_ts: lastUserTs, cost_at_turn_start: cur }),
          );
        } catch {}
      }
    }
    const turnDelta = Math.max(0, cur - turnStartCost);
    const fmt2 = (n: number) => `$${n.toFixed(2)}`;
    const fmt4 = (n: number) => `$${n.toFixed(4)}`;
    const yellow = ansi.fg(220);
    const cyan = ansi.fg(45);
    const green = ansi.fg(40);
    const red = ansi.fg(196);
    const dim = ansi.sgr(2);
    const added = cost.total_lines_added ?? 0;
    const removed = cost.total_lines_removed ?? 0;
    const diff = `${green}+${added}${ansi.reset}${dim}/${ansi.reset}${red}-${removed}${ansi.reset}`;
    costPart = ` ${yellow}Δ${fmt4(turnDelta)}${ansi.reset} ${cyan}${fmt2(cur)}${ansi.reset} ${diff}`;
  }

  const barsLine = barParts.join(" ") + costPart;

  // PR
  let prLine = "";
  try {
    let branch = currentBookmark.split(",")[0];
    if (!branch) {
      try {
        branch = execFileSync("git", ["branch", "--show-current"], {
          cwd,
          encoding: "utf-8",
          timeout: 3000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch {}
    }
    if (branch && repo) {
      const cachePath = prCachePath(repo, branch);
      let pr = loadPrCache(cachePath) as {
        number?: number;
        title?: string;
        statusCheckRollup?: unknown[];
      } | null;
      if (pr === null) {
        try {
          const prJson = execFileSync(
            "gh",
            ["pr", "view", branch, "--json", "number,title,statusCheckRollup"],
            { cwd, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
          );
          pr = JSON.parse(prJson);
        } catch {
          // Cache "no PR" result to avoid re-querying within TTL.
          pr = { number: undefined };
        }
        savePrCache(cachePath, pr);
      }
      if (pr?.number) {
        const red = ansi.sgr("31");
        const green = ansi.sgr("32");
        const prUrl = repo
          ? `https://${repo.host}/${repo.owner}/${repo.repo}/pull/${pr.number}`
          : "";
        const title = pr.title ?? "";
        const numPart = prUrl ? ansi.link(prUrl, `#${pr.number}`) : `#${pr.number}`;
        const titlePart = prUrl ? ansi.link(prUrl, title) : title;
        let checksStr = "";
        const checks: any[] = pr.statusCheckRollup ?? [];
        if (checks.length > 0) {
          const total = checks.length;
          const failed = checks.filter(
            (c: any) =>
              c.conclusion === "FAILURE" ||
              c.conclusion === "ERROR" ||
              c.conclusion === "CANCELLED",
          );
          const pass = checks.filter((c: any) => c.conclusion === "SUCCESS").length;
          const parts: string[] = [];
          if (failed.length > 0) {
            const failNames = failed.map((c: any) => {
              const name = c.name ?? c.context ?? "unknown";
              const url = c.detailsUrl ?? c.targetUrl ?? "";
              return url ? ansi.link(url, name) : name;
            });
            parts.push(`${red}${failed.length}${ansi.reset}(${failNames.join(", ")})`);
          }
          if (pass > 0) parts.push(`${green}${pass}${ansi.reset}`);
          checksStr = ` ${parts.join("+")}=${total}`;
        }
        prLine = `${numPart} ${titlePart}${checksStr}`;
      }
    }
  } catch {}

  const sessionId: string = input.session_id ?? "";
  let sessionPart = "";
  const duplicateLines: string[] = [];
  if (sessionId) {
    const { entries, hasOther } = listSessionInstances(sessionId);
    const sessionLabel = `💬${sessionId}`;
    if (hasOther) {
      const redBg = `${ansi.bg(196)}${ansi.fg(15)}`;
      sessionPart = `${redBg}${sessionLabel}${ansi.reset}`;
      const yellow = ansi.fg(220);
      const green = ansi.fg(46);
      const red = ansi.fg(196);
      duplicateLines.push(
        `${yellow}⚠ DUPLICATE SESSION: quit other(s) before typing.${ansi.reset}`,
      );
      const now = Date.now();
      const upStr = entries.map((e) => formatUptime(now - e.startedAt));
      const pidW = Math.max(...entries.map((e) => String(e.pid).length));
      const upW = Math.max(...upStr.map((s) => s.length));
      const statusW = Math.max(...entries.map((e) => e.status.length));
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i]!;
        const mark = e.self ? `${green}self${ansi.reset}` : `${red}other${ansi.reset}`;
        duplicateLines.push(
          `${formatStartedAt(e.startedAt)}  ${upStr[i]!.padStart(upW)}  ${String(e.pid).padStart(pidW)}  ${e.status.padEnd(statusW)}  ${mark}`,
        );
      }
    } else {
      sessionPart = sessionLabel;
    }
  }

  // Output
  const lines: string[] = [];
  if (barsLine) lines.push(barsLine);
  const locationParts = [locationLine, vcsInfo, sessionPart].filter(Boolean);
  lines.push(locationParts.join(" "));
  for (const l of duplicateLines) lines.push(l);
  if (prLine) lines.push(prLine);
  process.stdout.write(lines.join("\n"));
}
