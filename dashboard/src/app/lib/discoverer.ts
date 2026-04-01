import fs from "fs";
import path from "path";

export interface DiscovererCase {
  id: string;
  label: string;
  task: string;
  enabled: boolean;
  depends_on?: string | null;
  skip_dependents_on_fail?: boolean;
}

export interface DiscovererWorkflow {
  id: string;
  label: string;
  description?: string;
  enabled: boolean;
  case_ids: string[];
}

export interface DiscovererTestConfig {
  project: string;
  description: string;
  test_cases: DiscovererCase[];
  workflows: DiscovererWorkflow[];
}

export interface WorkspaceContext {
  workspacePath: string;
  workspaceName: string;
  fileCount: number;
  sampledFiles: string[];
  stackHints: string[];
  runScripts: string[];
  routeHints: string[];
  keyFiles: Array<{ file: string; snippet: string }>;
}

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  "results",
  ".turbo",
]);

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
]);

const MAX_DISCOVERY_FILES = 140;
const MAX_KEY_FILES = 20;
const MAX_SNIPPET_CHARS = 1400;

const DEFAULT_ALLOWED_WORKSPACE_ROOTS = ["/opt/workspaces"];

interface KnowledgeIndexEntry {
  project: string;
  workspacePath: string;
  file: string;
  updatedAt: string;
}

function normalizedPathForCompare(input: string): string {
  return path.resolve(input).replace(/\\/g, "/").replace(/\/$/, "");
}

function isWithinRoot(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizedPathForCompare(candidate);
  const normalizedRoot = normalizedPathForCompare(root);
  if (normalizedCandidate === normalizedRoot) return true;
  return normalizedCandidate.startsWith(`${normalizedRoot}/`);
}

export function allowedWorkspaceRoots(): string[] {
  const fromEnv = process.env.DISCOVERER_ALLOWED_ROOTS
    ?.split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const roots = fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_WORKSPACE_ROOTS;
  return Array.from(new Set(roots.map((r) => normalizedPathForCompare(r))));
}

export function resolveWorkspacePath(rawPath: string): string | null {
  const input = rawPath.trim();
  if (!input) return null;

  let resolved: string;
  try {
    resolved = path.resolve(input);
  } catch {
    return null;
  }

  if (!fs.existsSync(resolved)) return null;

  let canonical: string;
  try {
    canonical = fs.realpathSync(resolved);
  } catch {
    return null;
  }

  const roots = allowedWorkspaceRoots();
  if (!roots.some((root) => isWithinRoot(canonical, root))) {
    return null;
  }

  return canonical;
}

export function safeProjectSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
}

export function inferProjectSlugFromWorkspace(workspacePath: string): string {
  return safeProjectSlug(path.basename(workspacePath));
}

function readSnippet(filePath: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.slice(0, MAX_SNIPPET_CHARS);
  } catch {
    return "";
  }
}

function listFiles(root: string): string[] {
  const results: string[] = [];
  const stack = [root];

  while (stack.length > 0 && results.length < MAX_DISCOVERY_FILES) {
    const current = stack.pop();
    if (!current) continue;

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (results.length >= MAX_DISCOVERY_FILES) break;
      const full = path.join(current, entry.name);

      let lstat: fs.Stats;
      try {
        lstat = fs.lstatSync(full);
      } catch {
        continue;
      }

      if (lstat.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) {
          stack.push(full);
        }
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      results.push(full);
    }
  }

  return results;
}

function inferStackHints(files: string[], workspacePath: string): string[] {
  const hints = new Set<string>();
  const relFiles = files.map((f) => path.relative(workspacePath, f));

  if (relFiles.some((f) => f.includes("next.config"))) hints.add("Next.js");
  if (relFiles.some((f) => f.includes("vite.config"))) hints.add("Vite");
  if (relFiles.some((f) => f.endsWith("docker-compose.yml") || f.endsWith("docker-compose.yaml"))) hints.add("Docker Compose");
  if (relFiles.some((f) => f.endsWith("Dockerfile"))) hints.add("Docker");
  if (relFiles.some((f) => f.startsWith("openclaw/"))) hints.add("OpenClaw agent");
  if (relFiles.some((f) => f.includes("playwright"))) hints.add("Playwright");
  if (relFiles.some((f) => f.includes("tailwind.config"))) hints.add("Tailwind CSS");
  if (relFiles.some((f) => f.endsWith("requirements.txt") || f.endsWith("pyproject.toml"))) hints.add("Python");
  if (relFiles.some((f) => f.endsWith("package.json"))) hints.add("Node.js");

  return Array.from(hints);
}

function collectRunScripts(workspacePath: string): string[] {
  const packageJson = path.join(workspacePath, "package.json");
  if (!fs.existsSync(packageJson)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJson, "utf-8")) as {
      scripts?: Record<string, string>;
    };
    if (!parsed.scripts) return [];
    return Object.entries(parsed.scripts).map(([k, v]) => `${k}: ${v}`);
  } catch {
    return [];
  }
}

function collectRouteHints(files: string[], workspacePath: string): string[] {
  const hints = new Set<string>();
  for (const file of files) {
    const rel = path.relative(workspacePath, file).replaceAll("\\", "/");
    if (rel.includes("/app/") && rel.endsWith("/page.tsx")) {
      const route = rel
        .replace(/^.*\/app\//, "")
        .replace(/\/page\.tsx$/, "")
        .replace(/^$/, "/");
      hints.add(`/${route}`.replace(/\/\//g, "/"));
    }
    if (rel.includes("/api/") && rel.endsWith("/route.ts")) {
      const route = rel
        .replace(/^.*\/api\//, "")
        .replace(/\/route\.ts$/, "");
      hints.add(`/api/${route}`);
    }
  }
  return Array.from(hints).slice(0, 40);
}

export function collectWorkspaceContext(workspacePath: string): WorkspaceContext {
  const files = listFiles(workspacePath);
  const sampledFiles = files.map((f) => path.relative(workspacePath, f).replaceAll("\\", "/"));
  const keyFiles = files
    .filter((f) => /readme|package\.json|pyproject|next\.config|dockerfile|route\.ts|page\.tsx/i.test(path.basename(f)))
    .slice(0, MAX_KEY_FILES)
    .map((f) => ({ file: path.relative(workspacePath, f).replaceAll("\\", "/"), snippet: readSnippet(f) }));

  return {
    workspacePath,
    workspaceName: path.basename(workspacePath),
    fileCount: sampledFiles.length,
    sampledFiles,
    stackHints: inferStackHints(files, workspacePath),
    runScripts: collectRunScripts(workspacePath),
    routeHints: collectRouteHints(files, workspacePath),
    keyFiles,
  };
}

export function buildTestConfigFromContext(project: string, ctx: WorkspaceContext): DiscovererTestConfig {
  const hasLogin = ctx.routeHints.some((r) => /\/login/i.test(r));
  const hasApi = ctx.routeHints.some((r) => r.startsWith("/api/"));

  const testCases: DiscovererCase[] = [
    {
      id: "homepage_load",
      label: "Homepage loads",
      task: "Go to {{BASE_URL}} and verify the homepage renders without visible errors in the UI or browser console. Return SUCCESS if the main page is usable.",
      enabled: true,
      depends_on: null,
      skip_dependents_on_fail: true,
    },
    {
      id: "core_navigation",
      label: "Core navigation",
      task: "From {{BASE_URL}}, navigate through the primary visible sections/pages and confirm each destination loads with no blocking errors. Return SUCCESS if navigation works end-to-end.",
      enabled: true,
      depends_on: "homepage_load",
      skip_dependents_on_fail: true,
    },
  ];

  if (hasLogin) {
    testCases.push({
      id: "login_flow",
      label: "Login flow",
      task: "Open {{BASE_URL}}/login (or the app login entry), authenticate using primary identifier {{LOGIN_ID}} (email/username/mobile) and {{PASSWORD}}. If backend reports '\"user_name\" is missing', retry by explicitly filling user_name/username field selectors with {{LOGIN_ID}} before submitting again. Confirm authenticated success via dashboard/home URL change or OTP/verification checkpoint and return SUCCESS only when post-auth progress is verified.",
      enabled: true,
      depends_on: "homepage_load",
      skip_dependents_on_fail: true,
    });
  }

  if (hasApi) {
    testCases.push({
      id: "api_smoke",
      label: "API smoke checks",
      task: "Using browser devtools/network validation from the app flow, verify critical API calls return successful responses during normal usage. Return SUCCESS when key API paths are healthy.",
      enabled: true,
      depends_on: "core_navigation",
      skip_dependents_on_fail: false,
    });
  }

  const workflows: DiscovererWorkflow[] = [
    {
      id: "smoke",
      label: "Smoke",
      description: "Critical path validation for page load and core navigation.",
      enabled: true,
      case_ids: testCases.filter((c) => c.id !== "api_smoke").map((c) => c.id),
    },
    {
      id: "full",
      label: "Full",
      description: "All discovered regression checks for this workspace.",
      enabled: true,
      case_ids: testCases.map((c) => c.id),
    },
  ];

  const stack = ctx.stackHints.length > 0 ? ctx.stackHints.join(", ") : "not auto-detected";

  return {
    project,
    description: `Auto-generated by Discoverer for ${ctx.workspaceName}. Stack hints: ${stack}.`,
    test_cases: testCases,
    workflows,
  };
}

export function buildAgentDocs(project: string, ctx: WorkspaceContext): string {
  const stack = ctx.stackHints.length > 0 ? ctx.stackHints.map((s) => `- ${s}`).join("\n") : "- No clear stack hints found";
  const scripts = ctx.runScripts.length > 0 ? ctx.runScripts.map((s) => `- ${s}`).join("\n") : "- No package scripts discovered";
  const routes = ctx.routeHints.length > 0 ? ctx.routeHints.slice(0, 25).map((r) => `- ${r}`).join("\n") : "- No route hints discovered";
  const files = ctx.sampledFiles.slice(0, 40).map((f) => `- ${f}`).join("\n");

  return [
    `# ${project} — Agent Knowledge`,
    "",
    `Generated from workspace: ${ctx.workspacePath}`,
    `Scanned files: ${ctx.fileCount}`,
    "",
    "## Stack Hints",
    stack,
    "",
    "## Run Commands",
    scripts,
    "",
    "## Route Hints",
    routes,
    "",
    "## File Inventory (sample)",
    files || "- No files sampled",
    "",
    "## Agent Guidance",
    "- Prefer minimal, surgical changes and align with existing code patterns.",
    "- When changing tests, update regression_tests/test_cases and keep workflow IDs stable.",
    "- Validate changes with typecheck/build before marking tasks complete.",
    "- If requirements are ambiguous, infer from existing route and component conventions.",
    "",
    "## Key Snippets",
    ...ctx.keyFiles.map((k) => `### ${k.file}\n\n\`\`\`\n${k.snippet}\n\`\`\``),
    "",
  ].join("\n");
}

export function ensureKnowledgeDir(): string {
  const dir = path.join(process.cwd(), "..", "openclaw", "data", "knowledge");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function knowledgeFile(project: string): string {
  return path.join(ensureKnowledgeDir(), `${project}.md`);
}

export function writeKnowledge(project: string, content: string, workspacePath: string): string {
  const dir = ensureKnowledgeDir();
  const filePath = path.join(dir, `${project}.md`);
  fs.writeFileSync(filePath, content);

  const indexPath = path.join(dir, "index.json");
  const prev: KnowledgeIndexEntry[] =
    fs.existsSync(indexPath)
      ? (JSON.parse(fs.readFileSync(indexPath, "utf-8")) as KnowledgeIndexEntry[])
      : [];

  const canonicalWorkspace = (() => {
    try {
      return fs.realpathSync(workspacePath);
    } catch {
      return workspacePath;
    }
  })();

  const next = prev.filter((p) => p.project !== project);
  next.push({ project, workspacePath: canonicalWorkspace, file: filePath, updatedAt: new Date().toISOString() });
  fs.writeFileSync(indexPath, JSON.stringify(next, null, 2));

  return filePath;
}

export function readKnowledgeByWorkspace(workspacePath?: string): string {
  if (!workspacePath) return "";

  const canonicalWorkspace = resolveWorkspacePath(workspacePath);
  if (!canonicalWorkspace) return "";

  const dir = ensureKnowledgeDir();
  const indexPath = path.join(dir, "index.json");
  let filePath = "";

  if (fs.existsSync(indexPath)) {
    try {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as KnowledgeIndexEntry[];
      const match = index.find((entry) => {
        const candidate = (() => {
          try {
            return fs.realpathSync(entry.workspacePath);
          } catch {
            return entry.workspacePath;
          }
        })();
        return normalizedPathForCompare(candidate) === normalizedPathForCompare(canonicalWorkspace);
      });
      if (match?.file) {
        filePath = match.file;
      }
    } catch {
      filePath = "";
    }
  }

  if (!filePath) {
    const fallbackProject = inferProjectSlugFromWorkspace(canonicalWorkspace);
    filePath = knowledgeFile(fallbackProject);
  }

  if (!fs.existsSync(filePath)) return "";
  try {
    return fs.readFileSync(filePath, "utf-8").slice(0, 9000);
  } catch {
    return "";
  }
}
