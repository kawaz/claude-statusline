import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { calcElapsed, contextBar, dualBar } from "./bar";

// OSC 8 hyperlink: clickable in terminals that support it
function osc(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

function parseRepo(dir: string): { host: string; owner: string; repo: string } | null {
  const m = dir.match(/\/repos\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (!m) return null;
  return { host: m[1], owner: m[2], repo: m[3] };
}

export function readKeychain(service: string): Record<string, any> | null {
  for (const args of [
    ["find-generic-password", "-s", service, "-a", process.env.USER ?? "", "-w"],
    ["find-generic-password", "-s", service, "-w"],
  ]) {
    try {
      return JSON.parse(execFileSync("security", args, { encoding: "utf-8", timeout: 3000 }));
    } catch {}
  }
  return null;
}

export function writeKeychain(service: string, creds: Record<string, any>): void {
  try {
    execFileSync(
      "security",
      [
        "add-generic-password",
        "-U",
        "-s",
        service,
        "-a",
        process.env.USER ?? "",
        "-w",
        JSON.stringify(creds),
      ],
      { encoding: "utf-8", timeout: 5000 },
    );
  } catch {}
}

export function refreshAccessToken(refreshToken: string): {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshTokenExpiresAt?: number;
} | null {
  try {
    const res = execFileSync(
      "curl",
      [
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
          scope:
            "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
        }),
        "https://platform.claude.com/v1/oauth/token",
      ],
      { encoding: "utf-8", timeout: 20000 },
    );
    const data = JSON.parse(res);
    if (!data.access_token) return null;
    const result: {
      accessToken: string;
      refreshToken: string;
      expiresAt: number;
      refreshTokenExpiresAt?: number;
    } = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 28800) * 1000,
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

export function configDirToService(configDir: string, type: "CC" | "ST"): string {
  const home = process.env.HOME ?? "";
  const base =
    configDir === `${home}/.claude`
      ? "Claude Code-credentials"
      : `Claude Code-credentials-${createHash("sha256").update(configDir).digest("hex").slice(0, 8)}`;
  return type === "ST" ? `${base}-ST` : base;
}

export function configDirToHash(configDir: string): string {
  const home = process.env.HOME ?? "";
  return configDir === `${home}/.claude`
    ? ""
    : createHash("sha256").update(configDir).digest("hex").slice(0, 8);
}

export function readPathEntries(): { path: string; hash: string }[] {
  const cacheDir = `${process.env.XDG_CACHE_HOME || `${process.env.HOME}/.cache`}/kawaz-claude-statusline`;
  const pathsFile = `${cacheDir}/paths.jsonl`;
  try {
    const content = readFileSync(pathsFile, "utf-8");
    const entries: { path: string; hash: string }[] = [];
    for (const line of content.split("\n").filter((l) => l.trim())) {
      try {
        entries.push(JSON.parse(line));
      } catch {}
    }
    return entries;
  } catch {
    return [];
  }
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
  const finderLink = osc(`file://${cwd}`, "📂");
  let locationLine: string;
  if (repo) {
    const ownerUrl = `https://${repo.host}/${repo.owner}`;
    const repoUrl = `https://${repo.host}/${repo.owner}/${repo.repo}`;
    locationLine = `${finderLink} ${osc(ownerUrl, repo.owner)}/${osc(repoUrl, repo.repo)}`;
  } else {
    locationLine = osc(`file://${cwd}`, cwd);
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

    const coloredParts = jjExec([
      "log",
      "-r",
      "@",
      "--no-graph",
      "--color=always",
      "-T",
      'separate("\\t", if(current_working_copy, label("node working_copy", "@")), format_short_change_id(change_id), self.bookmarks(), format_short_commit_id(commit_id))',
    ]).split("\t");
    const [coloredNode, coloredCid, coloredBms, coloredCommit] = coloredParts;
    const plainData = jjExec([
      "log",
      "-r",
      "@",
      "--no-graph",
      "-T",
      'separate("\\t", self.bookmarks().join(","), commit_id.short(8), if(immutable, "true", "false"))',
    ]).split("\t");
    const [plainBms, plainCommit, isImmutable] = plainData;
    currentBookmark = plainBms;

    const bmPart =
      coloredBms && repoBase && currentBookmark
        ? osc(`${repoBase}/tree/${currentBookmark.split(",")[0]}`, coloredBms)
        : coloredBms;
    const commitPart =
      repoBase && isImmutable === "true"
        ? osc(`${repoBase}/commit/${plainCommit}`, coloredCommit)
        : coloredCommit;

    const parts = [coloredNode, coloredCid, bmPart, commitPart].filter(Boolean);
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
  const modelName = input.model?.display_name ?? "";

  const usageUrl = "https://claude.ai/settings/usage";
  const barParts: string[] = [];
  const barWidth = 10;
  function formatRemaining(resetsAtSec: number): string {
    const ms = Math.max(0, resetsAtSec * 1000 - Date.now());
    const totalM = Math.floor(ms / 60_000);
    const m = totalM % 60;
    const totalH = Math.floor(totalM / 60);
    const h = totalH % 24;
    const d = Math.floor(totalH / 24);
    const pp = (n: number) => String(n).padStart(2, "0");
    if (d > 0) return `${d}d${pp(h)}h`;
    if (totalH >= 10) return `${pp(totalH)}h${pp(m)}m`;
    if (totalH >= 1) return `${totalH}h${pp(m)}m`;
    return `${pp(totalM)}m`;
  }

  function dualInfo(util: number, elapsed: number, resetsAtSec: number): string {
    const TU = util >= 80 ? "196" : util >= 50 ? "220" : "40";
    const BU = "39";
    const BA = "24";
    const rst = "\x1b[0m";
    return ` \x1b[38;5;${TU}m${util}%${rst}/\x1b[38;5;${BU}m${Math.round(elapsed)}%${rst}/\x1b[38;5;${BA}m${formatRemaining(resetsAtSec)}${rst}`;
  }

  const ctxPct = Math.round(ctx?.used_percentage ?? 0);
  barParts.push(`${osc(usageUrl, "🧠")} ${contextBar(ctxPct, barWidth)}`);

  const rl = input.rate_limits;
  if (rl?.five_hour && rl?.seven_day) {
    const f5 = Math.round(rl.five_hour.used_percentage);
    const f5resetsAt = new Date(rl.five_hour.resets_at * 1000).toISOString();
    const f5elapsed = calcElapsed(f5resetsAt, 5);
    barParts.push(
      `${osc(usageUrl, "⏰")} ${dualBar(f5, f5elapsed, barWidth)}${dualInfo(f5, f5elapsed, rl.five_hour.resets_at)}`,
    );

    const f7 = Math.round(rl.seven_day.used_percentage);
    const f7resetsAt = new Date(rl.seven_day.resets_at * 1000).toISOString();
    const f7elapsed = calcElapsed(f7resetsAt, 7 * 24);
    barParts.push(
      `${osc(usageUrl, "📆")} ${dualBar(f7, f7elapsed, barWidth)}${dualInfo(f7, f7elapsed, rl.seven_day.resets_at)}`,
    );
  }

  if (modelName) barParts.push(modelName);
  const barsLine = barParts.join(" | ");

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
    if (branch) {
      const prJson = execFileSync(
        "gh",
        ["pr", "view", branch, "--json", "number,title,statusCheckRollup"],
        { cwd, encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
      );
      const pr = JSON.parse(prJson);
      if (pr?.number) {
        const red = "\x1b[31m";
        const green = "\x1b[32m";
        const rst = "\x1b[0m";
        const prUrl = repo
          ? `https://${repo.host}/${repo.owner}/${repo.repo}/pull/${pr.number}`
          : "";
        const numPart = prUrl ? osc(prUrl, `#${pr.number}`) : `#${pr.number}`;
        const titlePart = prUrl ? osc(prUrl, pr.title) : pr.title;
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

  // Output
  const lines: string[] = [];
  if (barsLine) lines.push(barsLine);
  const locationParts = [locationLine, vcsInfo].filter(Boolean);
  lines.push(locationParts.join(" "));
  if (prLine) lines.push(prLine);
  process.stdout.write(lines.join("\n"));
}
