export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { checkAuth, readSettings, writeSettings, generateToken } from "@/app/lib/settings";

export async function POST(req: NextRequest) {
  if (!(await checkAuth(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const settings = readSettings();
  writeSettings({ ...settings, session_token: generateToken() });
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("uwu_session");
  return res;
}
