import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { execSync } from "child_process";

interface CodingSessionInput {
  projectId: string;
  worktreeId?: string;
  tool: "opencode" | "claude" | "codex";
  task: string;
}

function runTool(
  tool: "opencode" | "claude" | "codex",
  task: string,
  workingDir: string
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve) => {
    let cmd = "";
    switch (tool) {
      case "opencode":
        cmd = `opencode "${task}"`;
        break;
      case "claude":
        cmd = `claude --print "${task}"`;
        break;
      case "codex":
        cmd = `codex "${task}"`;
        break;
    }

    try {
      const output = execSync(cmd, {
        encoding: "utf-8",
        timeout: 300000,
        cwd: workingDir,
      });
      resolve({ output, exitCode: 0 });
    } catch (err: unknown) {
      const error = err as { stderr?: { toString?: () => string }; status?: number };
      resolve({
        output: error.stderr?.toString?.() || String(err),
        exitCode: error.status || 1,
      });
    }
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("projectId");
    const status = searchParams.get("status");

    const db = getDb();
    const sessions = projectId
      ? await db.select().from(schema.codingSessions).where(eq(schema.codingSessions.projectId, projectId))
      : status
        ? await db.select().from(schema.codingSessions).where(eq(schema.codingSessions.status, status))
        : await db.select().from(schema.codingSessions);

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error("[/api/coding-sessions GET] Error:", error);
    return NextResponse.json({ error: "Failed to fetch coding sessions" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { projectId, worktreeId, tool, task } = body as CodingSessionInput;

    if (!projectId || !tool || !task) {
      return NextResponse.json(
        { error: "projectId, tool, and task are required" },
        { status: 400 }
      );
    }

    const db = getDb();
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId)).get();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    let workingDir = project.path;
    if (worktreeId) {
      const worktree = await db.select().from(schema.worktrees).where(eq(schema.worktrees.id, worktreeId)).get();
      if (worktree) {
        workingDir = worktree.path;
      }
    }

    const id = randomUUID();
    const startedAt = new Date();

    await db.insert(schema.codingSessions).values({
      id,
      projectId,
      worktreeId: worktreeId || null,
      tool,
      status: "running",
      task,
      startedAt,
    });

    const result = await runTool(tool, task, workingDir);

    const completedAt = new Date();
    const durationSeconds = Math.round((completedAt.getTime() - startedAt.getTime()) / 1000);

    await db
      .update(schema.codingSessions)
      .set({
        status: result.exitCode === 0 ? "completed" : "failed",
        result: result.output,
        completedAt,
        durationSeconds,
      })
      .where(eq(schema.codingSessions.id, id));

    const session = await db.select().from(schema.codingSessions).where(eq(schema.codingSessions.id, id)).get();

    return NextResponse.json({ success: true, session });
  } catch (error) {
    console.error("[/api/coding-sessions POST] Error:", error);
    return NextResponse.json({ error: "Failed to run coding session" }, { status: 500 });
  }
}
