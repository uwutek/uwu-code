export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { checkAuth, readSettings, writeSettings } from "@/app/lib/settings";

const DEFAULT_OPENCLAW_MODEL = "openrouter/free";
const DEFAULT_OPENCODE_MODEL = "";
const DEFAULT_CLAUDECODE_MODEL = "";

const OPENCODE_CONFIG = path.join(os.homedir(), ".config", "opencode", "opencode.json");
const CLAUDE_SETTINGS = path.join(os.homedir(), ".claude", "settings.json");

export interface ORModel {
  id: string;
  name: string;
  context_length: number;
  pricing: { prompt: string; completion: string };
  free: boolean;
  prompt_price_per_m: number;
}

export interface SimpleModel {
  id: string;
  name: string;
}

function prettyName(id: string): string {
  const tail = id.split("/").at(-1) ?? id;
  return tail
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function readJsonFile(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return {}; }
}

function writeJsonFile(filePath: string, data: Record<string, unknown>) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getOpencodeModels(): SimpleModel[] {
  try {
    const output = execSync("opencode models", {
      timeout: 10000,
      env: { ...process.env, HOME: os.homedir() },
      cwd: os.homedir(),
    }).toString().trim();
    return output
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((id) => ({ id, name: prettyName(id) }));
  } catch {
    return [];
  }
}

function getClaudeCodeModels(): SimpleModel[] {
  return [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    { id: "claude-opus-4-5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-1", name: "Claude Opus 4.1" },
    { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
  ];
}

function getOpencodeSelected(): string {
  const cfg = readJsonFile(OPENCODE_CONFIG);
  return (cfg.model as string) ?? DEFAULT_OPENCODE_MODEL;
}

function getClaudeCodeSelected(): string {
  const cfg = readJsonFile(CLAUDE_SETTINGS);
  return (cfg.model as string) ?? DEFAULT_CLAUDECODE_MODEL;
}

export async function GET(_req: NextRequest) {
  const settings = readSettings();
  const [opencodeModels, claudeModels] = [getOpencodeModels(), getClaudeCodeModels()];

  return NextResponse.json({
    models: [], // OpenRouter models (openclaw) – fetched client-side via separate OR call
    selected: {
      openclaw: settings.models?.openclaw ?? DEFAULT_OPENCLAW_MODEL,
      opencode: getOpencodeSelected(),
      claudecode: getClaudeCodeSelected(),
    },
    opencodeModels,
    claudeCodeModels: claudeModels,
  });
}

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json() as { openclaw?: string; opencode?: string; claudecode?: string };

  // Save openclaw model in settings.json
  const settings = readSettings();
  writeSettings({
    ...settings,
    models: {
      ...settings.models,
      openclaw: body.openclaw ?? settings.models?.openclaw ?? DEFAULT_OPENCLAW_MODEL,
    },
  });

  // Save opencode model in ~/.config/opencode/opencode.json
  if (body.opencode !== undefined) {
    const cfg = readJsonFile(OPENCODE_CONFIG);
    if (body.opencode) {
      cfg.model = body.opencode;
    } else {
      delete cfg.model;
    }
    writeJsonFile(OPENCODE_CONFIG, cfg);
  }

  // Save claude code model in ~/.claude/settings.json
  if (body.claudecode !== undefined) {
    const cfg = readJsonFile(CLAUDE_SETTINGS);
    if (body.claudecode) {
      cfg.model = body.claudecode;
    } else {
      delete cfg.model;
    }
    writeJsonFile(CLAUDE_SETTINGS, cfg);
  }

  return NextResponse.json({ ok: true });
}
