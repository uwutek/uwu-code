export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/app/lib/settings";

interface ParsedRepo {
  owner: string;
  repo: string;
}

function parseGitUrl(url: string): ParsedRepo | null {
  if (!url) return null;
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  const sshMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

async function fetchGitHub(path: string, token: string, method = "GET", body?: object) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub API error: ${res.status} - ${err.message || res.statusText}`);
  }
  return res.json();
}

export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const gitUrl = searchParams.get("url");

  if (!gitUrl) {
    return NextResponse.json({ error: "url parameter is required" }, { status: 400 });
  }

  const parsed = parseGitUrl(gitUrl);
  if (!parsed) {
    return NextResponse.json({ error: "Invalid GitHub URL" }, { status: 400 });
  }

  const settings = readSettings();
  const token = settings.github_token;
  if (!token) {
    return NextResponse.json({ error: "GitHub token not configured" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { action, issueNumber, milestoneNumber } = body;

    if (action === "close_issue" && issueNumber) {
      await fetchGitHub(
        `/repos/${parsed.owner}/${parsed.repo}/issues/${issueNumber}`,
        token,
        "PATCH",
        { state: "closed" }
      );
      return NextResponse.json({ success: true, message: `Issue #${issueNumber} closed` });
    }

    if (action === "close_milestone" && milestoneNumber) {
      const issues = await fetchGitHub(
        `/repos/${parsed.owner}/${parsed.repo}/issues?state=open&milestone=${milestoneNumber}&per_page=100`,
        token
      ) as Array<{ number: number }>;
      
      const realIssues = issues.filter((issue) => !("pull_request" in issue));

      for (const issue of realIssues) {
        await fetchGitHub(
          `/repos/${parsed.owner}/${parsed.repo}/issues/${issue.number}`,
          token,
          "PATCH",
          { state: "closed" }
        );
      }

      await fetchGitHub(
        `/repos/${parsed.owner}/${parsed.repo}/milestones/${milestoneNumber}`,
        token,
        "PATCH",
        { state: "closed" }
      );

      return NextResponse.json({ 
        success: true, 
        message: `Milestone #${milestoneNumber} closed (${realIssues.length} issues closed)` 
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("[/api/github/close POST] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to close";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}