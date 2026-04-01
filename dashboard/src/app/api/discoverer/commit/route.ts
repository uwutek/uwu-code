import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { execFile } from "child_process";

export const dynamic = "force-dynamic";

const REPO_ROOT = path.join(process.cwd(), "..");

interface CommitRequest {
  files?: string[];
  message?: string;
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

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = (body ?? {}) as CommitRequest;
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    return NextResponse.json({ error: "files[] required" }, { status: 400 });
  }

  const message = (parsed.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Commit message required" }, { status: 400 });
  }

  const targets = parsed.files
    .map((filePath) => (typeof filePath === "string" ? filePath.trim() : ""))
    .filter(Boolean)
    .map((filePath) => path.resolve(filePath))
    .filter(isUnderRepoRoot)
    .map((abs) => path.relative(REPO_ROOT, abs).replace(/\\/g, "/"));

  if (targets.length === 0) {
    return NextResponse.json({ error: "No valid files under repository root" }, { status: 400 });
  }

  const addResult = await runGit(["-C", REPO_ROOT, "add", "--", ...targets]);
  if (addResult.code !== 0) {
    return NextResponse.json({ error: addResult.stderr || "git add failed" }, { status: 500 });
  }

  const stagedResult = await runGit(["-C", REPO_ROOT, "diff", "--cached", "--name-only", "--", ...targets]);
  const stagedFiles = stagedResult.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (stagedFiles.length === 0) {
    return NextResponse.json({ error: "No staged changes to commit" }, { status: 400 });
  }

  const commitResult = await runGit(["-C", REPO_ROOT, "commit", "-m", message]);
  if (commitResult.code !== 0) {
    return NextResponse.json({ error: commitResult.stderr || commitResult.stdout || "git commit failed" }, { status: 500 });
  }

  const headResult = await runGit(["-C", REPO_ROOT, "rev-parse", "--short", "HEAD"]);

  return NextResponse.json({
    ok: true,
    commit: headResult.stdout.trim(),
    summary: commitResult.stdout.trim(),
    files: stagedFiles,
  });
}
