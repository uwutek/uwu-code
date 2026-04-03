import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getDefaultPaths, getReadableProjectPaths } from "@/app/lib/tests-paths";

const MAX_RESULTS = 300;
const IGNORE_DIRS = new Set([".git", "node_modules", ".next", "dist", "build", ".venv", "venv", "__pycache__"]);

function scanSpecFiles(baseDir: string): string[] {
  const out: string[] = [];
  if (!baseDir || !fs.existsSync(baseDir)) return out;
  const stack = [baseDir];
  while (stack.length > 0 && out.length < MAX_RESULTS) {
    const dir = stack.pop();
    if (!dir) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) stack.push(abs);
        continue;
      }
      let isFileEntry = entry.isFile();
      if (!isFileEntry && entry.isSymbolicLink()) {
        try {
          const stat = fs.statSync(abs);
          isFileEntry = stat.isFile();
        } catch {
          continue;
        }
      }
      if (!isFileEntry) continue;
      if (!entry.name.endsWith(".spec.py") && !entry.name.endsWith(".spec.ts")) continue;
      out.push(abs);
      if (out.length >= MAX_RESULTS) break;
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = (searchParams.get("project") ?? "").trim();
  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project" }, { status: 400 });
  }

  const paths = getReadableProjectPaths(project);
  const defaults = getDefaultPaths(project);
  const candidates = [
    path.join(paths.regressionDir, "specs"),
    path.join(defaults.regressionDir, "specs"),
    paths.workspacePath,
  ].filter((v): v is string => !!v);

  const seen = new Set<string>();
  const files: string[] = [];
  const addFile = (file: string) => {
    const normalized = path.resolve(file);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    files.push(normalized);
  };

  for (const candidate of candidates) {
    const found = scanSpecFiles(candidate);
    for (const file of found) {
      addFile(file);
      if (files.length >= MAX_RESULTS) break;
    }
    if (files.length >= MAX_RESULTS) break;
  }

  const defaultSpecCandidates = [
    path.join(paths.regressionDir, "specs", `${project}.spec.ts`),
    path.join(paths.regressionDir, "specs", `${project}.spec.py`),
    path.join(defaults.regressionDir, "specs", `${project}.spec.ts`),
    path.join(defaults.regressionDir, "specs", `${project}.spec.py`),
  ];
  for (const candidate of defaultSpecCandidates) {
    if (files.length >= MAX_RESULTS) break;
    if (fs.existsSync(candidate)) addFile(candidate);
  }

  files.sort((a, b) => a.localeCompare(b));
  return NextResponse.json({ files });
}
