import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  allowedWorkspaceRoots,
  buildAgentDocs,
  buildTestConfigFromContext,
  collectWorkspaceContext,
  inferProjectSlugFromWorkspace,
  resolveWorkspacePath,
  safeProjectSlug,
  writeKnowledge,
} from "@/app/lib/discoverer";

export const dynamic = "force-dynamic";

const REGRESSION_DIR = path.join(process.cwd(), "..", "regression_tests");
const TEST_CASES_DIR = path.join(REGRESSION_DIR, "test_cases");

interface DiscovererRequest {
  workspacePath?: string;
  project?: string;
  persistTests?: boolean;
  persistDocs?: boolean;
}

function ensureTestCasesDir() {
  if (!fs.existsSync(TEST_CASES_DIR)) {
    fs.mkdirSync(TEST_CASES_DIR, { recursive: true });
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const parsed = body as DiscovererRequest;

  if (parsed.workspacePath !== undefined && typeof parsed.workspacePath !== "string") {
    return NextResponse.json({ error: "workspacePath must be a string" }, { status: 400 });
  }
  if (parsed.project !== undefined && typeof parsed.project !== "string") {
    return NextResponse.json({ error: "project must be a string" }, { status: 400 });
  }
  if (parsed.persistTests !== undefined && typeof parsed.persistTests !== "boolean") {
    return NextResponse.json({ error: "persistTests must be a boolean" }, { status: 400 });
  }
  if (parsed.persistDocs !== undefined && typeof parsed.persistDocs !== "boolean") {
    return NextResponse.json({ error: "persistDocs must be a boolean" }, { status: 400 });
  }

  const workspacePath = (parsed.workspacePath ?? "").trim();
  if (!workspacePath) {
    return NextResponse.json({ error: "workspacePath required" }, { status: 400 });
  }

  const normalizedWorkspace = resolveWorkspacePath(workspacePath);
  if (!normalizedWorkspace) {
    const roots = allowedWorkspaceRoots();
    return NextResponse.json(
      { error: `workspacePath must be an accessible directory under allowed roots: ${roots.join(", ")}` },
      { status: 400 }
    );
  }

  const explicitProject = (parsed.project ?? "").trim();
  const project = safeProjectSlug(explicitProject || inferProjectSlugFromWorkspace(normalizedWorkspace));
  if (!project) {
    return NextResponse.json({ error: "Unable to infer a valid project slug" }, { status: 400 });
  }

  const persistTests = parsed.persistTests !== false;
  const persistDocs = parsed.persistDocs !== false;

  const context = collectWorkspaceContext(normalizedWorkspace);
  const testConfig = buildTestConfigFromContext(project, context);
  const agentDocs = buildAgentDocs(project, context);

  let testCasesFile = "";
  let knowledgeFile = "";

  if (persistTests) {
    ensureTestCasesDir();
    testCasesFile = path.join(TEST_CASES_DIR, `${project}.json`);
    fs.writeFileSync(testCasesFile, JSON.stringify(testConfig, null, 2));
  }

  if (persistDocs) {
    knowledgeFile = writeKnowledge(project, agentDocs, normalizedWorkspace);
  }

  return NextResponse.json({
    project,
    workspacePath: normalizedWorkspace,
    testConfig,
    agentDocs,
    context: {
      workspaceName: context.workspaceName,
      fileCount: context.fileCount,
      stackHints: context.stackHints,
      runScripts: context.runScripts,
      routeHints: context.routeHints,
    },
    persisted: {
      tests: persistTests,
      docs: persistDocs,
      testCasesFile: testCasesFile || undefined,
      knowledgeFile: knowledgeFile || undefined,
    },
  });
}
