import { NextRequest, NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const worktreeId = searchParams.get("worktreeId");

    const db = getDb();
    
    let connections: typeof schema.connections.$inferSelect[];
    if (worktreeId) {
      connections = await db
        .select()
        .from(schema.connections)
        .where(eq(schema.connections.sourceWorktreeId, worktreeId));
    } else {
      connections = await db.select().from(schema.connections);
    }

    const connectionsWithDetails = await Promise.all(
      connections.map(async (conn) => {
        const sourceWorktree = await db
          .select()
          .from(schema.worktrees)
          .where(eq(schema.worktrees.id, conn.sourceWorktreeId))
          .get();
        const targetWorktree = await db
          .select()
          .from(schema.worktrees)
          .where(eq(schema.worktrees.id, conn.targetWorktreeId))
          .get();
        return {
          ...conn,
          sourceWorktree,
          targetWorktree,
        };
      })
    );

    return NextResponse.json({ connections: connectionsWithDetails });
  } catch (error) {
    console.error("[/api/connections GET] Error:", error);
    return NextResponse.json({ error: "Failed to fetch connections" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceWorktreeId, targetWorktreeId, type, notes } = body;

    if (!sourceWorktreeId || !targetWorktreeId || !type) {
      return NextResponse.json(
        { error: "sourceWorktreeId, targetWorktreeId, and type are required" },
        { status: 400 }
      );
    }

    const db = getDb();

    const sourceWorktree = await db
      .select()
      .from(schema.worktrees)
      .where(eq(schema.worktrees.id, sourceWorktreeId))
      .get();
    if (!sourceWorktree) {
      return NextResponse.json({ error: "Source worktree not found" }, { status: 404 });
    }

    const targetWorktree = await db
      .select()
      .from(schema.worktrees)
      .where(eq(schema.worktrees.id, targetWorktreeId))
      .get();
    if (!targetWorktree) {
      return NextResponse.json({ error: "Target worktree not found" }, { status: 404 });
    }

    const id = randomUUID();
    const now = new Date();

    await db.insert(schema.connections).values({
      id,
      sourceWorktreeId,
      targetWorktreeId,
      type,
      notes: notes || null,
      createdAt: now,
    });

    const connection = await db
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.id, id))
      .get();

    return NextResponse.json({ connection }, { status: 201 });
  } catch (error) {
    console.error("[/api/connections POST] Error:", error);
    return NextResponse.json({ error: "Failed to create connection" }, { status: 500 });
  }
}
