#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { isatty } from "tty";
import { runStatusbar } from "./statusbar";
import { runSample } from "./sample";

const args = process.argv.slice(2);
const cmd = args[0];

function help(): void {
  console.log(`Usage: kawaz-claude-statusline <command> [options]

Commands:
  run       Output statusbar (reads JSON from stdin)
  register  Register statusLine.command in ~/.claude/settings.json
  sample    Visualize bars with sample data

Run 'kawaz-claude-statusline <command> --help' for more information on a command.`);
}

function register(regArgs: string[]): void {
  const force = regArgs.includes("--force");

  if (regArgs.includes("--help")) {
    console.log(`Usage: kawaz-claude-statusline register [--force]

Register statusLine.command in ~/.claude/settings.json.

Options:
  --force    Overwrite existing statusLine setting`);
    return;
  }

  const settingsPath = `${process.env.HOME}/.claude/settings.json`;
  let settings: Record<string, any> = {};
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {}

  if (settings.statusLine && !force) {
    console.error("");
    console.error("statusLine is already configured in ~/.claude/settings.json:");
    console.error(`  ${JSON.stringify(settings.statusLine)}`);
    console.error("");
    console.error("Use --force to overwrite.");
    process.exit(1);
  }

  const scriptPath = resolve(process.argv[1] ?? "");
  const command = `bun ${scriptPath} run`;
  settings.statusLine = {
    type: "command",
    command,
  };

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
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
status display with context window, usage bars (5h/7d), VCS info, and PR.`);
      break;
    }
    runStatusbar();
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
