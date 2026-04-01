import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";

export const dynamic = "force-dynamic";

const REPO_ROOT = path.join(process.cwd(), "..");
const MAX_DIFF_CHARS = 120_000;

interface ReviewRequest {
  files?: string[];
}

interface GitRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function normalizeRepoPath(input: string): string {
  return path.resolve(input).replace(/\\/g, "/");
}

function isUnderRepoRoot(candidate: string): boolean {
  const root = normalizeRepoPath(REPO_ROOT);
  const resolved = normalizeRepoPath(candidate);
  return resolved === root || resolved.startsWith(`${root}/`);
}

function normalizeGitPath(filePath: string): string {
  return filePath.replace(/^"|"$/g, "").replace(/\\/g, "/");
}

function classifyStatus(status: string): string {
  if (!status) return "clean";
  if (status === "??") return "untracked";
  if (status.includes("R")) return "renamed";
  if (status.includes("A")) return "added";
  if (status.includes("D")) return "deleted";
  if (status.includes("M")) return "modified";
  return "staged";
}

function runGit(args: string[]): Promise<GitRunResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let code = 0;
        if (error) {
          const rawCode = (error as NodeJS.ErrnoException).code;
          if (typeof rawCode === "number") {
            code = rawCode;
          } else if (typeof rawCode === "string") {
            const parsedCode = Number(rawCode);
            code = Number.isFinite(parsedCode) ? parsedCode : 1;
          } else {
            code = 1;
          }
        }
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          code,
        });
      }
    );
  });
}

function parsePorcelainStatus(output: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of output.split("\n")) {
    if (!line.trim() || line.length < 4) continue;
    const rawStatus = line.slice(0, 2);
    let rawPath = line.slice(3).trim();
    if (rawPath.includes(" -> ")) {
      rawPath = rawPath.split(" -> ").at(-1) ?? rawPath;
    }
    map.set(normalizeGitPath(rawPath), rawStatus.trim() || rawStatus);
  }
  return map;
}

function clampDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n\n[diff truncated]`;
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = (body ?? {}) as ReviewRequest;
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    return NextResponse.json({ error: "files[] required" }, { status: 400 });
  }

  const targets = parsed.files
    .map((filePath) => (typeof filePath === "string" ? filePath.trim() : ""))
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath))
    .filter(isUnderRepoRoot)
    .map((abs) => ({
      abs,
      rel: path.relative(REPO_ROOT, abs).replace(/\\/g, "/"),
    }));

  if (targets.length === 0) {
    return NextResponse.json({ error: "No valid files under repository root" }, { status: 400 });
  }

  const statusResult = await runGit(["-C", REPO_ROOT, "status", "--porcelain", "--", ...targets.map((t) => t.rel)]);
  const statusMap = parsePorcelainStatus(statusResult.stdout);

  const files = [] as Array<{ path: string; status: string; diff: string }>;
  for (const target of targets) {
    const statusRaw = statusMap.get(target.rel) ?? "";
    const status = fs.existsSync(target.abs) ? classifyStatus(statusRaw) : "missing";

    let diff = "";
    if (status === "untracked" && fs.existsSync(target.abs)) {
      const untrackedDiff = await runGit(["-C", REPO_ROOT, "diff", "--no-index", "--", "/dev/null", target.rel]);
      diff = untrackedDiff.stdout || untrackedDiff.stderr;
    } else if (status !== "clean" && status !== "missing") {
      const staged = await runGit(["-C", REPO_ROOT, "diff", "--cached", "--", target.rel]);
      const unstaged = await runGit(["-C", REPO_ROOT, "diff", "--", target.rel]);
      diff = [staged.stdout, unstaged.stdout].filter((part) => part.trim().length > 0).join("\n");
    }

    files.push({
      path: target.rel,
      status,
      diff: clampDiff(diff),
    });
  }

  return NextResponse.json({
    repoRoot: REPO_ROOT,
    hasChanges: files.some((file) => !["clean", "missing"].includes(file.status)),
    files,
  });
}
