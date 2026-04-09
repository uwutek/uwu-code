import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/app/lib/auth-token";
import { readSettings } from "@/app/lib/settings";

const LOGIN_PATH = "/login";
const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/check",
]);

const AGENT_BOOTSTRAP_PATHS = new Set([
  "/api/settings/agent-key",
]);

const INTERNAL_SECRET = process.env.AUTH_SECRET?.trim();

function isAgentAuthenticated(request: NextRequest): boolean {
  if (request.headers.get("x-agent-source") !== "openclaw") {
    return false;
  }
  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return false;
  }
  const settings = readSettings();
  const agentKey = settings.agent_api_key || process.env.AGENT_API_KEY?.trim();
  if (!agentKey) return false;
  const token = authHeader.slice(7);
  return token === agentKey;
}

async function isAuthenticated(request: NextRequest): Promise<boolean> {
  if (INTERNAL_SECRET && request.headers.get("x-internal-secret") === INTERNAL_SECRET) {
    return true;
  }
  if (isAgentAuthenticated(request)) {
    return true;
  }
  const token = request.cookies.get("uwu_session")?.value;
  try {
    const settings = readSettings();
    const payload = await verifySessionToken(token, settings.session_token);
    return !!payload;
  } catch (error) {
    console.error("Session verification failed:", error);
    return false;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname === "/favicon.ico") {
    return NextResponse.next();
  }

  if (PUBLIC_API_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  if (AGENT_BOOTSTRAP_PATHS.has(pathname)) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || request.headers.get("x-real-ip")
      || "";
    if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost" || ip === "") {
      return NextResponse.next();
    }
  }

  const authenticated = await isAuthenticated(request);

  if (pathname === LOGIN_PATH) {
    if (authenticated) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!authenticated) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
