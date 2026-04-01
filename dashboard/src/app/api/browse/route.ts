export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const WORKSPACES_ROOT = "/opt/workspaces";

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  hasChildren: boolean;
}

function isWithinRoot(candidate: string): boolean {
  const resolved = path.resolve(candidate);
  const root = path.resolve(WORKSPACES_ROOT);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

export async function GET(req: NextRequest) {
  const dirParam = req.nextUrl.searchParams.get("path") || WORKSPACES_ROOT;
  const resolved = path.resolve(dirParam);

  if (!isWithinRoot(resolved)) {
    return NextResponse.json({ error: "Path outside workspaces" }, { status: 400 });
  }

  if (!fs.existsSync(resolved)) {
    return NextResponse.json({ error: "Path not found" }, { status: 404 });
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: "Not a directory" }, { status: 400 });
  }

  const entries: DirEntry[] = [];

  for (const dirent of fs.readdirSync(resolved, { withFileTypes: true })) {
    if (dirent.name.startsWith(".")) continue;
    if (!dirent.isDirectory()) continue;

    const fullPath = path.join(resolved, dirent.name);
    let hasChildren = false;
    try {
      hasChildren = fs
        .readdirSync(fullPath, { withFileTypes: true })
        .some((d) => d.isDirectory() && !d.name.startsWith("."));
    } catch {
    }

    entries.push({
      name: dirent.name,
      path: fullPath,
      isDirectory: true,
      hasChildren,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return NextResponse.json({ path: resolved, root: WORKSPACES_ROOT, entries });
}
