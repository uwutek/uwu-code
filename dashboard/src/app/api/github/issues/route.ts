export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { readSettings } from "@/app/lib/settings";

interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  labels: Array<{ name: string; color: string }>;
  milestone: {
    id: number;
    number: number;
    title: string;
    state: "open" | "closed";
  } | null;
  assignee: {
    login: string;
    avatar_url: string;
  } | null;
  created_at: string;
  updated_at: string;
}

interface GitHubMilestone {
  id: number;
  number: number;
  title: string;
  state: "open" | "closed";
  description: string | null;
  html_url: string;
  open_issues: number;
  closed_issues: number;
  due_on: string | null;
}

interface ParsedRepo {
  owner: string;
  repo: string;
}

function parseGitUrl(url: string): ParsedRepo | null {
  if (!url) return null;
  // https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  // git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }
  return null;
}

async function fetchGitHub(path: string, token: string) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
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
    const [issues, milestones]: [GitHubIssue[], GitHubMilestone[]] = await Promise.all([
      fetchGitHub(`/repos/${parsed.owner}/${parsed.repo}/issues?state=open&per_page=100`, token),
      fetchGitHub(`/repos/${parsed.owner}/${parsed.repo}/milestones?state=open&per_page=50`, token),
    ]);

    // Filter out pull requests (they appear in issues API)
    const realIssues = issues.filter((issue) => !("pull_request" in issue));

    // Group issues by milestone
    const milestoneMap = new Map<number, { milestone: GitHubMilestone; issues: GitHubIssue[] }>();
    const issuesWithoutMilestone: GitHubIssue[] = [];

    for (const milestone of milestones) {
      milestoneMap.set(milestone.number, { milestone, issues: [] });
    }

    for (const issue of realIssues) {
      if (issue.milestone) {
        const entry = milestoneMap.get(issue.milestone.number);
        if (entry) {
          entry.issues.push(issue);
        } else {
          // Milestone not in our list yet (closed milestone maybe)
          issuesWithoutMilestone.push(issue);
        }
      } else {
        issuesWithoutMilestone.push(issue);
      }
    }

    return NextResponse.json({
      owner: parsed.owner,
      repo: parsed.repo,
      milestones: Array.from(milestoneMap.values()),
      unassigned: issuesWithoutMilestone,
    });
  } catch (error) {
    console.error("[/api/github/issues GET] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to fetch issues";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}