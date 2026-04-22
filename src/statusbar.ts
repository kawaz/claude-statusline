import { execFileSync } from "child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
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
// See docs/dr-gh-pr-cache.md.
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

export function runStatusbar(): void {
  const raw = readFileSync("/dev/stdin", "utf-8");
  if (!raw.trim()) {
    console.error("Error: No input on stdin. This command expects JSON from Claude Code.");
    process.exit(1);
  }
  const input = JSON.parse(raw);
  const cwd: string = input.workspace?.current_dir ?? "";

  const repo = parseRepo(cwd);
  const encCwd = encPath(cwd);
  const finderLink = ansi.link(`file://${encCwd}`, "📂");
  const vscodeLink = `[${ansi.link(`vscode://file${encCwd}`, "VSCode")}]`;

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

  let locationLine: string;
  if (repo) {
    const ownerUrl = `https://${repo.host}/${repo.owner}`;
    const repoUrl = `https://${repo.host}/${repo.owner}/${repo.repo}`;
    const dimBlue = ansi.sgr("2;34");
    const blue = ansi.sgr("34");
    locationLine = `${finderLink}${vscodeLink}${remoteLink} ${dimBlue}${ansi.link(ownerUrl, repo.owner)}${ansi.reset}/${blue}${ansi.link(repoUrl, repo.repo)}${ansi.reset}`;
  } else {
    locationLine = `${finderLink}${vscodeLink}${remoteLink} ` + ansi.link(`file://${encCwd}`, cwd);
  }

  // VCS: try jj, fall back to git
  let vcsInfo = "";
  let currentBookmark = "";
  const jjOpts = {
    cwd,
    encoding: "utf-8" as const,
    timeout: 3000,
    stdio: ["pipe", "pipe", "pipe"] as const,
  };
  function jjExec(args: string[]): string {
    return execFileSync("jj", args, jjOpts).trim();
  }
  try {
    const repoBase = repo ? `https://${repo.host}/${repo.owner}/${repo.repo}` : "";

    // Single jj log call emits both colored and plain fields, separated by \x1f (US).
    // concat() preserves empty fields (separate() skips them, which misaligns splits).
    const combined = jjExec([
      "log",
      "-r",
      "@",
      "--no-graph",
      "--color=always",
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
          "latest(ancestors(@-) & bookmarks())",
          "--no-graph",
          "-T",
          'self.bookmarks().join(",")',
        ]);
      } catch {}
    }
    currentBookmark = currentBookmark.split(",")[0];
  } catch {
    try {
      const branch = execFileSync("git", ["branch", "--show-current"], {
        cwd,
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      const shortHash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd,
        encoding: "utf-8",
        timeout: 3000,
      }).trim();
      vcsInfo = [branch, shortHash].filter(Boolean).join(" ");
      currentBookmark = branch;
    } catch {}
  }

  // Bars
  const ctx = input.context_window;
  const rawModel = (input.model?.id ?? "").replace(/^claude-/, "");
  const modelName = rawModel
    ? `${ansi.fg(40)}${rawModel.replace(/\[.*/, (s) => `${ansi.dim}${ansi.fg(40)}${s}`)}${ansi.reset}`
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

  const barsLine = barParts.join(" ");

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
        const numPart = prUrl ? ansi.link(prUrl, `#${pr.number}`) : `#${pr.number}`;
        const titlePart = prUrl ? ansi.link(prUrl, pr.title) : pr.title;
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
  const sessionPart = sessionId ? `💬${sessionId}` : "";

  // Output
  const lines: string[] = [];
  if (barsLine) lines.push(barsLine);
  const locationParts = [locationLine, vcsInfo, sessionPart].filter(Boolean);
  lines.push(locationParts.join(" "));
  if (prLine) lines.push(prLine);
  process.stdout.write(lines.join("\n"));
}
