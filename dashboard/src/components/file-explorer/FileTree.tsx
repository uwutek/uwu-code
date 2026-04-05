"use client";

import { useState } from "react";
import {
  VscFile,
  VscFolder,
  VscFolderOpened,
  VscJson,
  VscMarkdown,
  VscSymbolColor,
  VscPython,
} from "react-icons/vsc";
import {
  SiTypescript,
  SiJavascript,
  SiHtml5,
  SiCss,
  SiSass,
  SiLess,
  SiRust,
  SiGo,
  SiNpm,
  SiGit,
  SiDocker,
  SiYaml,
  SiToml,
  SiSvelte,
  SiVuedotjs,
  SiPrisma,
} from "react-icons/si";
import { FaShieldAlt, FaImage, FaTerminal, FaLock } from "react-icons/fa";
import { BiData } from "react-icons/bi";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  gitStatus?: "modified" | "added" | "deleted" | "untracked" | "renamed" | "copied" | "unmerged" | "unknown";
  children?: FileNode[];
}

interface FileTreeProps {
  nodes: FileNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  filter?: string;
}

const gitStatusColors: Record<string, string> = {
  modified:  "bg-yellow-500",
  added:     "bg-green-500",
  deleted:   "bg-red-500",
  untracked: "bg-gray-500",
  renamed:   "bg-blue-500",
  copied:    "bg-purple-500",
  unmerged:  "bg-orange-500",
  unknown:   "bg-gray-400",
};

const gitStatusLabels: Record<string, string> = {
  modified:  "M",
  added:     "A",
  deleted:   "D",
  untracked: "?",
  renamed:   "R",
  copied:    "C",
  unmerged:  "U",
  unknown:   "!",
};

const ICON_SIZE = 15;

function getFileIcon(name: string) {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  const style = { width: ICON_SIZE, height: ICON_SIZE, flexShrink: 0 };

  // Specific filenames first
  if (lower === "package.json" || lower === "package-lock.json")
    return <SiNpm size={ICON_SIZE} color="#cb3837" style={style} />;
  if (lower === ".gitignore" || lower === ".gitattributes")
    return <SiGit size={ICON_SIZE} color="#f14e32" style={style} />;
  if (lower === "dockerfile" || lower === ".dockerignore")
    return <SiDocker size={ICON_SIZE} color="#2496ed" style={style} />;
  if (lower === ".env" || lower.startsWith(".env."))
    return <FaLock size={ICON_SIZE - 2} color="#ffd700" style={style} />;
  if (lower === "prisma" || ext === "prisma")
    return <SiPrisma size={ICON_SIZE - 1} color="#5a67d8" style={style} />;

  // By extension
  if (ext === "ts" || ext === "mts" || ext === "cts")
    return <SiTypescript size={ICON_SIZE} color="#3178c6" style={style} />;
  if (ext === "tsx")
    return <SiTypescript size={ICON_SIZE} color="#00d4ff" style={style} />;
  if (ext === "js" || ext === "mjs" || ext === "cjs")
    return <SiJavascript size={ICON_SIZE} color="#f7df1e" style={style} />;
  if (ext === "jsx")
    return <SiJavascript size={ICON_SIZE} color="#61dafb" style={style} />;
  if (ext === "py" || ext === "pyw")
    return <VscPython size={ICON_SIZE} color="#3776ab" style={style} />;
  if (ext === "html" || ext === "htm")
    return <SiHtml5 size={ICON_SIZE} color="#e44d26" style={style} />;
  if (ext === "css")
    return <SiCss size={ICON_SIZE} color="#264de4" style={style} />;
  if (ext === "scss" || ext === "sass")
    return <SiSass size={ICON_SIZE} color="#c69" style={style} />;
  if (ext === "less")
    return <SiLess size={ICON_SIZE} color="#1d365d" style={style} />;
  if (ext === "rs")
    return <SiRust size={ICON_SIZE} color="#dea584" style={style} />;
  if (ext === "go")
    return <SiGo size={ICON_SIZE} color="#00add8" style={style} />;
  if (ext === "json" || ext === "jsonc")
    return <VscJson size={ICON_SIZE} color="#cbcb41" style={style} />;
  if (ext === "md" || ext === "mdx")
    return <VscMarkdown size={ICON_SIZE} color="#083fa1" style={style} />;
  if (ext === "yaml" || ext === "yml")
    return <SiYaml size={ICON_SIZE - 1} color="#cb171e" style={style} />;
  if (ext === "toml")
    return <SiToml size={ICON_SIZE - 1} color="#9c4121" style={style} />;
  if (ext === "svelte")
    return <SiSvelte size={ICON_SIZE - 1} color="#ff3e00" style={style} />;
  if (ext === "vue")
    return <SiVuedotjs size={ICON_SIZE - 1} color="#42b883" style={style} />;
  if (ext === "sh" || ext === "bash" || ext === "zsh" || ext === "fish")
    return <FaTerminal size={ICON_SIZE - 3} color="#89e051" style={style} />;
  if (["png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "avif"].includes(ext))
    return <FaImage size={ICON_SIZE - 2} color="#4bae50" style={style} />;
  if (ext === "svg")
    return <VscSymbolColor size={ICON_SIZE} color="#ffb13b" style={style} />;
  if (ext === "sql" || ext === "db" || ext === "sqlite")
    return <BiData size={ICON_SIZE} color="#336791" style={style} />;
  if (lower.includes("ignore") || lower.includes("eslint") || lower.includes("prettier"))
    return <FaShieldAlt size={ICON_SIZE - 3} color="#61afef" style={style} />;

  return <VscFile size={ICON_SIZE} color="var(--dim)" style={style} />;
}

function FileNodeComponent({
  node,
  selectedPath,
  onSelect,
  filter,
  depth = 0,
}: {
  node: FileNode;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  filter?: string;
  depth?: number;
}) {
  const [expanded, setExpanded] = useState(depth < 2);

  const matchesFilter = !filter || node.name.toLowerCase().includes(filter.toLowerCase());
  const hasMatchingChildren = node.children?.some(
    (child) =>
      !filter ||
      child.name.toLowerCase().includes(filter.toLowerCase()) ||
      child.children?.some((grandChild) => grandChild.name.toLowerCase().includes(filter.toLowerCase()))
  );

  if (filter && !matchesFilter && !hasMatchingChildren) return null;

  if (node.type === "directory") {
    return (
      <div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 w-full px-2 py-1 text-left text-sm file-tree-hover"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          {expanded
            ? <VscFolderOpened size={ICON_SIZE} color="var(--cyan)" style={{ flexShrink: 0 }} />
            : <VscFolder size={ICON_SIZE} color="var(--dim)" style={{ flexShrink: 0 }} />
          }
          <span style={{ color: expanded ? "var(--text)" : "var(--dim)" }}>{node.name}</span>
          {node.gitStatus && (
            <span className={`ml-auto w-4 h-4 rounded text-xs flex items-center justify-center text-white ${gitStatusColors[node.gitStatus]}`}>
              {gitStatusLabels[node.gitStatus]}
            </span>
          )}
        </button>
        {expanded && node.children && (
          <div>
            {node.children.map((child) => (
              <FileNodeComponent
                key={child.path}
                node={child}
                selectedPath={selectedPath}
                onSelect={onSelect}
                filter={filter}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  const isSelected = selectedPath === node.path;

  return (
    <button
      type="button"
      onClick={() => onSelect(node.path)}
      className={`flex items-center gap-1.5 w-full px-2 py-1 text-left text-sm ${isSelected ? "" : "file-tree-hover"}`}
      style={{
        paddingLeft: `${depth * 16 + 8}px`,
        color: isSelected ? "var(--text)" : "var(--dim)",
        background: isSelected ? "var(--selected-bg)" : undefined,
      }}
    >
      {getFileIcon(node.name)}
      <span className="truncate">{node.name}</span>
      {node.gitStatus && (
        <span className={`ml-auto w-4 h-4 rounded text-xs flex items-center justify-center text-white ${gitStatusColors[node.gitStatus]}`}>
          {gitStatusLabels[node.gitStatus]}
        </span>
      )}
    </button>
  );
}

export function FileTree({ nodes, selectedPath, onSelect, filter }: FileTreeProps) {
  return (
    <div className="h-full overflow-auto rounded" style={{ background: "var(--card)" }}>
      {nodes.map((node) => (
        <FileNodeComponent
          key={node.path}
          node={node}
          selectedPath={selectedPath}
          onSelect={onSelect}
          filter={filter}
        />
      ))}
    </div>
  );
}
