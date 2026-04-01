import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolveWorkspacePath } from "@/app/lib/discoverer";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const TEST_CASES_DIR = path.join(REGRESSION_DIR, "test_cases");

function ensureTestCasesDir() {
  if (!fs.existsSync(TEST_CASES_DIR)) {
    fs.mkdirSync(TEST_CASES_DIR, { recursive: true });
  }
}

/** GET /api/tests/cases                 → list of available project slugs
 *  GET /api/tests/cases?project=slug   → full test config for that project */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");

  ensureTestCasesDir();

  if (!project) {
    // Return list of available slugs
    const files = fs.existsSync(TEST_CASES_DIR)
      ? fs.readdirSync(TEST_CASES_DIR).filter((f) => /^[a-zA-Z0-9_-]+\.json$/.test(f))
      : [];
    const slugs = files.map((f) => f.replace(/\.json$/, ""));
    return NextResponse.json({ projects: slugs });
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  const file = path.join(TEST_CASES_DIR, `${project}.json`);
  const exists = fs.existsSync(file);
  if (!exists) {
    return NextResponse.json(
      {
        project,
        description: "",
        test_cases: [],
        workflows: [],
        exists: false,
      }
    );
  }

  try {
    const content = JSON.parse(fs.readFileSync(file, "utf-8"));
    return NextResponse.json({ ...content, exists: true });
  } catch {
    return NextResponse.json({ error: "Failed to read test cases" }, { status: 500 });
  }
}

/** PUT /api/tests/cases?project=slug  — save full test config (body = JSON) */
export async function PUT(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");
  const createMode = searchParams.get("create") === "1";

  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  ensureTestCasesDir();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid config payload" }, { status: 400 });
  }

  const asRecord = body as Record<string, unknown>;
  const providedWorkspace = typeof asRecord.workspace_path === "string" ? asRecord.workspace_path : "";
  if (providedWorkspace) {
    const resolved = resolveWorkspacePath(providedWorkspace);
    if (!resolved) {
      return NextResponse.json(
        { error: "workspace_path must be an accessible path under allowed workspace roots" },
        { status: 400 }
      );
    }
    asRecord.workspace_path = resolved;
  }

  const file = path.join(TEST_CASES_DIR, `${project}.json`);

  if (createMode && fs.existsSync(file)) {
    try {
      const existing = JSON.parse(fs.readFileSync(file, "utf-8")) as {
        test_cases?: unknown;
        workflows?: unknown;
      };
      const compatible = Array.isArray(existing.test_cases) && Array.isArray(existing.workflows);
      if (compatible) {
        return NextResponse.json({
          success: true,
          existed: true,
          reused: true,
          message: "Existing compatible tests project found; reusing without overwrite",
        });
      }
      return NextResponse.json(
        { error: "Existing project file is incompatible and was not overwritten" },
        { status: 409 }
      );
    } catch {
      return NextResponse.json(
        { error: "Existing project file could not be parsed and was not overwritten" },
        { status: 409 }
      );
    }
  }

  fs.writeFileSync(file, JSON.stringify(asRecord, null, 2));

  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const project = searchParams.get("project");

  if (!project || !/^[a-zA-Z0-9_-]+$/.test(project)) {
    return NextResponse.json({ error: "Invalid project name" }, { status: 400 });
  }

  ensureTestCasesDir();

  const configFile = path.join(TEST_CASES_DIR, `${project}.json`);
  const envFile = path.join(TEST_CASES_DIR, `${project}.env.json`);
  const resultsDir = path.join(REGRESSION_DIR, "results", project);

  const removed: string[] = [];
  const maybeRemove = (target: string, kind: "file" | "dir") => {
    if (!fs.existsSync(target)) return;
    if (kind === "file") fs.unlinkSync(target);
    else fs.rmSync(target, { recursive: true, force: true });
    removed.push(target);
  };

  maybeRemove(configFile, "file");
  maybeRemove(envFile, "file");
  maybeRemove(resultsDir, "dir");

  return NextResponse.json({ success: true, removed });
}
