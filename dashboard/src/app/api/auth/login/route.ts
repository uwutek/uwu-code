export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { readSettings, writeSettings, hashPassword, generateToken } from "@/app/lib/settings";

export async function POST(req: NextRequest) {
  const { username, password } = await req.json() as { username: string; password: string };
  const settings = readSettings();

  const userTrimmed = (username ?? "").trim();
  if (!userTrimmed || !password) {
    return NextResponse.json({ error: "Username and password are required" }, { status: 400 });
  }

  if (!settings.username) {
    const token = generateToken();
    writeSettings({
      ...settings,
      username: userTrimmed,
      password_hash: hashPassword(password),
      session_token: token,
    });

    const res = NextResponse.json({ ok: true, initialized: true });
    res.cookies.set("uwu_session", token, {
      httpOnly: true,
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      sameSite: "lax",
    });
    return res;
  }

  if (userTrimmed !== settings.username || hashPassword(password) !== settings.password_hash) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const token = generateToken();
  writeSettings({ ...settings, session_token: token });

  const res = NextResponse.json({ ok: true });
  res.cookies.set("uwu_session", token, {
    httpOnly: true,
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
    sameSite: "lax",
  });
  return res;
}
