"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

type TaskStatus = "pending" | "running" | "completed" | "failed" | "scheduled" | "manual" | "rate_limited";
type ScheduleMode = "anytime" | "once" | "daily" | "weekly" | "manual";
type TaskType = "coding" | "research";
type ToolPref = "auto" | "claude" | "opencode";

interface Task {
  id: string;
  title: string;
  type: TaskType;
  description: string;
  workspace?: string;
  preferred_tool?: ToolPref;
  status: TaskStatus;
  schedule_mode?: ScheduleMode;
  schedule_time?: string;
  schedule_weekday?: number;
  created_at: string;
  scheduled_at?: string;
  started_at?: string;
  completed_at?: string;
  last_run_at?: string;
  last_run_status?: "completed" | "failed";
  retry_at?: string;
  report?: string;
}

interface AgentStatus {
  state: "idle" | "running" | "stopped" | "error";
  current_task_id?: string | null;
  message?: string;
  updated_at?: string | null;
}

interface WorkspaceOption {
  name: string;
  path: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso?: string | null) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function fmtDate(iso?: string) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

const STATUS_COLOR: Record<string, string> = {
  pending:      "#ffd700",
  running:      "#00d4ff",
  completed:    "#00ff88",
  failed:       "#ff4444",
  scheduled:    "#a855f7",
  manual:       "#f97316",
  rate_limited: "#fb923c",
};

const STATUS_BG: Record<string, string> = {
  pending:      "rgba(255,215,0,0.1)",
  running:      "rgba(0,212,255,0.1)",
  completed:    "rgba(0,255,136,0.1)",
  failed:       "rgba(255,68,68,0.1)",
  scheduled:    "rgba(168,85,247,0.1)",
  manual:       "rgba(249,115,22,0.1)",
  rate_limited: "rgba(251,146,60,0.1)",
};

const AGENT_STATE_COLOR: Record<string, string> = {
  idle:    "#00ff88",
  running: "#00d4ff",
  stopped: "#4a5568",
  error:   "#ff4444",
};

const WEEK_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function scheduleLabel(task: Task): string {
  const mode = task.schedule_mode ?? "anytime";
  if (mode === "daily") return task.schedule_time ? `daily ${task.schedule_time} UTC` : "daily";
  if (mode === "weekly") {
    const day = typeof task.schedule_weekday === "number" ? WEEK_DAYS[task.schedule_weekday] ?? "weekly" : "weekly";
    return task.schedule_time ? `${day} ${task.schedule_time} UTC` : day;
  }
  if (mode === "once") return "one-time";
  if (mode === "manual") return "manual";
  return "queue now";
}

// ── Shared Input Styles ───────────────────────────────────────────────────────

const INPUT: React.CSSProperties = {
  background: "rgba(10,14,26,0.8)",
  border: "1px solid rgba(30,45,74,0.8)",
  color: "#e2e8f0",
  borderRadius: "6px",
  padding: "8px 12px",
  fontSize: "0.8rem",
  outline: "none",
  width: "100%",
};

// ── Task Form (shared by create + edit) ───────────────────────────────────────

interface TaskFormProps {
  initial?: Partial<Task>;
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}

function TaskForm({ initial, submitLabel, onSubmit, onCancel }: TaskFormProps) {
  const [type, setType] = useState<TaskType>(initial?.type ?? "research");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(initial?.schedule_mode ?? "anytime");
  const [oneTimeAt, setOneTimeAt] = useState(() => {
    if (initial?.scheduled_at) {
      const d = new Date(initial.scheduled_at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    const d = new Date(Date.now() + 5 * 60 * 1000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  });
  const [dailyTime, setDailyTime] = useState(initial?.schedule_time ?? "09:00");
  const [weeklyDay, setWeeklyDay] = useState<number>(initial?.schedule_weekday ?? new Date().getDay());
  const [weeklyTime, setWeeklyTime] = useState(initial?.schedule_time ?? "09:00");
  const [workspace, setWorkspace] = useState(initial?.workspace ?? "/opt/workspaces");
  const [tool, setTool] = useState<ToolPref>(initial?.preferred_tool ?? "auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceOption[]>([]);

  async function loadWorkspaceOptions() {
    setPickerLoading(true);
    setPickerError("");
    try {
      const res = await fetch("/api/projects");
      if (!res.ok) { setPickerError("Failed to load folders"); return; }
      const data = await res.json() as { projects?: Array<{ name?: string; path?: string }> };
      const opts: WorkspaceOption[] = (data.projects ?? [])
        .filter((p) => p.path)
        .map((p) => ({ name: p.name || p.path!, path: p.path! }));
      if (opts.length === 0) opts.push({ name: "workspaces", path: "/opt/workspaces" });
      const seen = new Set<string>();
      setWorkspaceOptions(opts.filter((o) => { if (seen.has(o.path)) return false; seen.add(o.path); return true; }).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      setPickerError("Failed to load folders");
    } finally {
      setPickerLoading(false);
    }
  }

  function toUtcTime(date: Date) {
    return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  }

  function nextDailyIso(time: string) {
    const [h, m] = time.split(":").map(Number);
    const c = new Date(); c.setHours(h, m, 0, 0);
    if (c.getTime() <= Date.now()) c.setDate(c.getDate() + 1);
    return c.toISOString();
  }

  function nextWeeklyIso(day: number, time: string) {
    const [h, m] = time.split(":").map(Number);
    const c = new Date();
    const delta = (day - c.getDay() + 7) % 7;
    c.setDate(c.getDate() + delta); c.setHours(h, m, 0, 0);
    if (c.getTime() <= Date.now()) c.setDate(c.getDate() + 7);
    return c.toISOString();
  }

  async function submit() {
    if (!description.trim()) { setError("Description is required"); return; }

    const payload: Record<string, unknown> = {
      title: title.trim() || undefined,
      type,
      description: description.trim(),
      workspace: type === "coding" ? workspace : undefined,
      preferred_tool: type === "coding" ? tool : undefined,
      schedule_mode: scheduleMode,
    };

    if (scheduleMode === "once") {
      const d = new Date(oneTimeAt);
      if (Number.isNaN(d.getTime())) { setError("Choose a valid one-time run date"); return; }
      const iso = d.toISOString();
      payload.one_time_at = iso;
      payload.scheduled_at = iso;
    }

    if (scheduleMode === "daily") {
      if (!dailyTime) { setError("Choose a daily run time"); return; }
      const nextIso = nextDailyIso(dailyTime);
      payload.schedule_time = toUtcTime(new Date(nextIso));
      payload.scheduled_at = nextIso;
    }

    if (scheduleMode === "weekly") {
      if (!weeklyTime) { setError("Choose a weekly run time"); return; }
      const nextIso = nextWeeklyIso(weeklyDay, weeklyTime);
      const nextDate = new Date(nextIso);
      payload.schedule_time = toUtcTime(nextDate);
      payload.schedule_weekday = nextDate.getUTCDay();
      payload.scheduled_at = nextIso;
    }

    setLoading(true); setError("");
    try {
      await onSubmit(payload);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-5 flex flex-col gap-4" style={{ border: "1px solid rgba(0,255,136,0.2)" }}>
      {/* Type toggle */}
      <div className="flex gap-2">
        {(["research", "coding"] as const).map((t) => (
          <button
            key={t} type="button" onClick={() => setType(t)}
            className="flex-1 py-2 rounded text-sm font-medium transition-all"
            style={{
              background: type === t ? (t === "coding" ? "rgba(0,212,255,0.15)" : "rgba(168,85,247,0.15)") : "rgba(30,45,74,0.3)",
              color: type === t ? (t === "coding" ? "#00d4ff" : "#a855f7") : "#4a5568",
              border: `1px solid ${type === t ? (t === "coding" ? "rgba(0,212,255,0.4)" : "rgba(168,85,247,0.4)") : "rgba(30,45,74,0.5)"}`,
            }}
          >
            {t === "coding" ? "💻 Coding" : "🔬 Research"}
          </button>
        ))}
      </div>

      {/* Schedule mode */}
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "#4a5568" }}>Schedule</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {([
            { key: "anytime", label: "Queue Now" },
            { key: "once",    label: "One-Time" },
            { key: "daily",   label: "Daily" },
            { key: "weekly",  label: "Weekly" },
            { key: "manual",  label: "Manual" },
          ] as const).map((mode) => (
            <button
              key={mode.key} type="button" onClick={() => setScheduleMode(mode.key)}
              className="py-2 rounded text-xs font-medium transition-all"
              style={{
                background: scheduleMode === mode.key ? "rgba(249,115,22,0.15)" : "rgba(30,45,74,0.3)",
                color: scheduleMode === mode.key ? "#f59e0b" : "#94a3b8",
                border: `1px solid ${scheduleMode === mode.key ? "rgba(249,115,22,0.4)" : "rgba(30,45,74,0.5)"}`,
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {scheduleMode === "once" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: "#4a5568" }}>Run at (local time)</label>
          <input type="datetime-local" style={INPUT} value={oneTimeAt} onChange={(e) => setOneTimeAt(e.target.value)} />
        </div>
      )}

      {scheduleMode === "daily" && (
        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: "#4a5568" }}>Daily time (local)</label>
          <input type="time" style={INPUT} value={dailyTime} onChange={(e) => setDailyTime(e.target.value)} />
        </div>
      )}

      {scheduleMode === "weekly" && (
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs" style={{ color: "#4a5568" }}>Day</label>
            <select style={{ ...INPUT }} value={weeklyDay} onChange={(e) => setWeeklyDay(Number(e.target.value))}>
              {WEEK_DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs" style={{ color: "#4a5568" }}>Time (local)</label>
            <input type="time" style={{ ...INPUT }} value={weeklyTime} onChange={(e) => setWeeklyTime(e.target.value)} />
          </div>
        </div>
      )}

      {/* Title */}
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "#4a5568" }}>Title (optional)</label>
        <input style={INPUT} placeholder="Short label…" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      {/* Workspace + Tool (coding only) */}
      {type === "coding" && (
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex flex-col gap-1 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs" style={{ color: "#4a5568" }}>Workspace</span>
              <button
                type="button"
                onClick={() => { setPickerOpen(true); if (workspaceOptions.length === 0) loadWorkspaceOptions(); }}
                className="text-xs px-2 py-0.5 rounded transition-colors"
                style={{ background: "rgba(0,212,255,0.12)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.3)" }}
              >
                Browse
              </button>
            </div>
            <div
              className="px-3 py-2 rounded text-xs font-mono"
              style={{ background: "rgba(10,14,26,0.8)", border: "1px solid rgba(30,45,74,0.8)", color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              title={workspace}
            >
              {workspace}
            </div>
          </div>
          <div className="flex flex-col gap-1 lg:w-[140px]">
            <label className="text-xs" style={{ color: "#4a5568" }}>Tool</label>
            <select style={{ ...INPUT }} value={tool} onChange={(e) => setTool(e.target.value as ToolPref)}>
              <option value="auto">Auto</option>
              <option value="claude">Claude Code</option>
              <option value="opencode">OpenCode</option>
            </select>
          </div>
        </div>
      )}

      {/* Description / prompt */}
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "#4a5568" }}>
          {type === "coding" ? "Task prompt (sent to opencode / claude code)" : "Research question / prompt"}
        </label>
        <textarea
          style={{ ...INPUT, minHeight: "110px", resize: "vertical" }}
          placeholder={
            type === "coding"
              ? "Describe the coding task in full detail. The scheduler will pass this directly to opencode or claude code."
              : "Ask a question or describe what you need to know. The scheduler calls the API directly."
          }
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      {error && (
        <div className="text-xs px-3 py-2 rounded" style={{ background: "rgba(255,68,68,0.1)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}>
          {error}
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-2">
        <button
          onClick={submit} type="button" disabled={loading}
          className="flex-1 py-2 rounded text-sm font-semibold transition-opacity"
          style={{
            background: loading ? "rgba(30,45,74,0.5)" : "rgba(0,255,136,0.15)",
            color: loading ? "#4a5568" : "#00ff88",
            border: "1px solid rgba(0,255,136,0.3)",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Saving…" : submitLabel}
        </button>
        <button
          onClick={onCancel} type="button"
          className="px-4 py-2 rounded text-sm transition-opacity hover:opacity-70"
          style={{ background: "rgba(30,45,74,0.4)", color: "#94a3b8", border: "1px solid rgba(30,45,74,0.7)" }}
        >
          Cancel
        </button>
      </div>

      {/* Workspace picker modal */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPickerOpen(false); }}
        >
          <div className="w-full max-w-2xl max-h-[75vh] flex flex-col rounded-lg overflow-hidden" style={{ background: "#0f1629", border: "1px solid #1e2d4a" }}>
            <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "#1e2d4a" }}>
              <div className="text-sm font-semibold" style={{ color: "#00d4ff" }}>Select Workspace Folder</div>
              <button type="button" onClick={() => setPickerOpen(false)} className="text-xs px-2 py-1 rounded" style={{ background: "rgba(30,45,74,0.6)", color: "#94a3b8", border: "1px solid #1e2d4a" }}>
                ✕ Close
              </button>
            </div>
            <div className="px-4 py-3 border-b" style={{ borderColor: "#1e2d4a" }}>
              <input type="text" value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} placeholder="Search folders…" style={INPUT} />
            </div>
            <div className="p-3 overflow-y-auto space-y-2" style={{ maxHeight: "50vh" }}>
              {pickerLoading && <div className="text-xs text-center py-4" style={{ color: "#4a5568" }}>Loading…</div>}
              {pickerError && <div className="text-xs px-3 py-2 rounded" style={{ color: "#ff4444", background: "rgba(255,68,68,0.1)", border: "1px solid rgba(255,68,68,0.2)" }}>{pickerError}</div>}
              {!pickerLoading && workspaceOptions
                .filter((o) => !pickerSearch.trim() || o.name.toLowerCase().includes(pickerSearch.toLowerCase()) || o.path.toLowerCase().includes(pickerSearch.toLowerCase()))
                .map((opt) => (
                  <button
                    key={opt.path} type="button"
                    onClick={() => { setWorkspace(opt.path); setPickerOpen(false); }}
                    className="w-full text-left px-3 py-2 rounded transition-opacity hover:opacity-85"
                    style={{ background: "rgba(30,45,74,0.35)", border: "1px solid rgba(30,45,74,0.7)" }}
                  >
                    <div className="text-xs font-semibold" style={{ color: "#00d4ff" }}>{opt.name}</div>
                    <div className="text-xs font-mono" style={{ color: "#94a3b8" }}>{opt.path}</div>
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Report Modal ──────────────────────────────────────────────────────────────

function ReportModal({ task, onClose }: { task: Task; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-4xl max-h-[85vh] flex flex-col rounded-lg overflow-hidden" style={{ background: "#0f1629", border: "1px solid #1e2d4a" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "#1e2d4a" }}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xs px-2 py-0.5 rounded font-semibold uppercase tracking-wider flex-shrink-0" style={{ background: STATUS_BG[task.status], color: STATUS_COLOR[task.status], border: `1px solid ${STATUS_COLOR[task.status]}40` }}>{task.status.replace("_", " ")}</span>
            <span className="font-semibold text-sm truncate" style={{ color: "#e2e8f0" }}>{task.title}</span>
          </div>
          <button onClick={onClose} type="button" className="text-xs px-2 py-1 rounded ml-3 flex-shrink-0" style={{ background: "rgba(30,45,74,0.6)", color: "#94a3b8", border: "1px solid #1e2d4a" }}>✕ Close</button>
        </div>
        <div className="flex flex-wrap gap-4 px-5 py-3 text-xs border-b flex-shrink-0" style={{ borderColor: "#1e2d4a", color: "#94a3b8" }}>
          <span>Type: <span style={{ color: task.type === "coding" ? "#00d4ff" : "#a855f7" }}>{task.type}</span></span>
          {task.workspace && <span>Workspace: <span style={{ color: "#e2e8f0" }} className="font-mono">{task.workspace}</span></span>}
          {task.preferred_tool && <span>Tool: <span style={{ color: "#ffd700" }}>{task.preferred_tool}</span></span>}
          <span>Created: {fmtDate(task.created_at)}</span>
          {task.completed_at && <span>Completed: {fmtDate(task.completed_at)}</span>}
        </div>
        <div className="px-5 py-3 border-b flex-shrink-0" style={{ borderColor: "#1e2d4a" }}>
          <div className="text-xs mb-1" style={{ color: "#4a5568" }}>Prompt</div>
          <div className="text-sm" style={{ color: "#94a3b8" }}>{task.description}</div>
        </div>
        <div className="flex-1 overflow-auto px-5 py-4">
          {task.report ? (
            <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono" style={{ color: "#e2e8f0" }}>{task.report}</pre>
          ) : (
            <div className="text-sm text-center py-12" style={{ color: "#4a5568" }}>No report yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Task Row ──────────────────────────────────────────────────────────────────

function TaskRow({
  task,
  isEditing,
  onEdit,
  onDelete,
  onQueueNow,
  onViewReport,
  onSaveEdit,
  onCancelEdit,
}: {
  task: Task;
  isEditing: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onQueueNow: () => void;
  onViewReport: () => void;
  onSaveEdit: (payload: Record<string, unknown>) => Promise<void>;
  onCancelEdit: () => void;
}) {
  const color = STATUS_COLOR[task.status] ?? "#94a3b8";
  const bg    = STATUS_BG[task.status]    ?? "rgba(30,45,74,0.2)";

  if (isEditing) {
    return (
      <div className="card overflow-hidden" style={{ border: "1px solid rgba(168,85,247,0.3)" }}>
        <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: "rgba(168,85,247,0.2)", background: "rgba(168,85,247,0.06)" }}>
          <span className="w-2 h-2 rounded-full" style={{ background: "#a855f7" }} />
          <span className="text-xs font-semibold" style={{ color: "#a855f7" }}>Editing: {task.title}</span>
        </div>
        <div className="p-4">
          <TaskForm
            initial={task}
            submitLabel="Save Changes"
            onSubmit={onSaveEdit}
            onCancel={onCancelEdit}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 flex flex-col gap-2" style={{ border: `1px solid ${color}25` }}>
      {/* Top row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          {task.status === "running"
            ? <span className="w-2 h-2 rounded-full pulse-dot flex-shrink-0" style={{ background: color }} />
            : <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />}
          <span className="font-semibold text-sm truncate" style={{ color: "#e2e8f0" }}>{task.title}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="text-xs px-2 py-0.5 rounded font-medium uppercase tracking-wider" style={{ background: bg, color, border: `1px solid ${color}40` }}>{task.status.replace("_", " ")}</span>
          <span
            className="text-xs px-2 py-0.5 rounded"
            style={{
              background: task.type === "coding" ? "rgba(0,212,255,0.1)" : "rgba(168,85,247,0.1)",
              color: task.type === "coding" ? "#00d4ff" : "#a855f7",
              border: `1px solid ${task.type === "coding" ? "rgba(0,212,255,0.2)" : "rgba(168,85,247,0.2)"}`,
            }}
          >{task.type}</span>
        </div>
      </div>

      {/* Description preview */}
      <div className="text-xs leading-relaxed line-clamp-2" style={{ color: "#94a3b8" }}>{task.description}</div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "#4a5568" }}>
        {task.workspace && <span className="font-mono truncate max-w-48" style={{ color: "#94a3b8" }}>📁 {task.workspace.split("/").slice(-2).join("/")}</span>}
        {task.preferred_tool && task.preferred_tool !== "auto" && <span style={{ color: "#ffd700" }}>{task.preferred_tool}</span>}
        <span style={{ color: "#f59e0b" }}>{scheduleLabel(task)}</span>
        <span>{timeAgo(task.created_at)}</span>
        {task.status === "scheduled" && task.scheduled_at && <span style={{ color: "#a855f7" }}>next {fmtDate(task.scheduled_at)}</span>}
        {task.status === "rate_limited" && task.retry_at && <span style={{ color: "#fb923c" }}>⏳ retry {fmtDate(task.retry_at)}</span>}
        {task.last_run_at && <span style={{ color: task.last_run_status === "failed" ? "#ff4444" : "#00ff88" }}>last {timeAgo(task.last_run_at)}</span>}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 pt-1 flex-wrap">
        {!["pending", "running"].includes(task.status) && task.report && (
          <button onClick={onViewReport} type="button" className="text-xs px-2.5 py-1 rounded transition-opacity hover:opacity-80" style={{ background: "rgba(0,212,255,0.1)", color: "#00d4ff", border: "1px solid rgba(0,212,255,0.25)" }}>
            View Report
          </button>
        )}
        {["failed", "scheduled", "manual", "completed", "rate_limited"].includes(task.status) && (
          <button onClick={onQueueNow} type="button" className="text-xs px-2.5 py-1 rounded transition-opacity hover:opacity-80" style={{ background: "rgba(255,215,0,0.08)", color: "#ffd700", border: "1px solid rgba(255,215,0,0.2)" }}>
            {task.status === "manual" ? "Add to Queue" : task.status === "rate_limited" ? "Force Retry" : "Queue Now"}
          </button>
        )}
        {!["running"].includes(task.status) && (
          <button onClick={onEdit} type="button" className="text-xs px-2.5 py-1 rounded transition-opacity hover:opacity-80" style={{ background: "rgba(168,85,247,0.08)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.2)" }}>
            Edit
          </button>
        )}
        <button onClick={onDelete} type="button" className="text-xs px-2.5 py-1 rounded transition-opacity hover:opacity-80 ml-auto" style={{ background: "rgba(255,68,68,0.08)", color: "#ff4444", border: "1px solid rgba(255,68,68,0.2)" }}>
          Delete
        </button>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OpenClawPage() {
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ state: "stopped" });
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [reportTask, setReportTask] = useState<Task | null>(null);
  const [tab, setTab]             = useState<"active" | "all">("active");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAll = useCallback(async () => {
    const [tasksRes, statusRes] = await Promise.allSettled([
      fetch("/api/scheduler/tasks"),
      fetch("/api/openclaw/status"),
    ]);
    if (tasksRes.status === "fulfilled" && tasksRes.value.ok) {
      const d = await tasksRes.value.json();
      setTasks(d.tasks ?? []);
    }
    if (statusRes.status === "fulfilled" && statusRes.value.ok) {
      setAgentStatus(await statusRes.value.json());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
    timerRef.current = setInterval(fetchAll, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchAll]);

  async function createTask(payload: Record<string, unknown>) {
    const res = await fetch("/api/scheduler/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error ?? "Failed to create task");
    }
    setShowCreate(false);
    fetchAll();
  }

  async function saveEdit(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/scheduler/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.error ?? "Failed to update task");
    }
    setEditingId(null);
    fetchAll();
  }

  async function deleteTask(id: string) {
    await fetch(`/api/scheduler/tasks/${id}`, { method: "DELETE" });
    if (editingId === id) setEditingId(null);
    fetchAll();
  }

  async function queueNow(id: string) {
    await fetch(`/api/scheduler/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "queue_now" }),
    });
    fetchAll();
  }

  const active    = tasks.filter((t) => ["pending", "running", "scheduled", "manual", "rate_limited"].includes(t.status));
  const displayed = tab === "active" ? active : tasks;

  const agentColor = AGENT_STATE_COLOR[agentStatus.state] ?? "#4a5568";
  const currentTask = agentStatus.current_task_id ? tasks.find((t) => t.id === agentStatus.current_task_id) : null;

  return (
    <div className="max-w-screen-lg mx-auto px-4 py-6 space-y-6 fade-in">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, #00ff88 0%, #00d4ff 100%)" }}
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="#0a0e1a" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold" style={{ color: "#00ff88" }}>OpenClaw</h1>
            <p className="text-xs" style={{ color: "#4a5568" }}>
              Schedule tasks · runs <span style={{ color: "#ffd700" }}>opencode</span> / <span style={{ color: "#00d4ff" }}>claude code</span> directly
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Agent status pill */}
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
            style={{ background: `${agentColor}12`, border: `1px solid ${agentColor}35`, color: agentColor }}
          >
            {agentStatus.state === "running"
              ? <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: agentColor }} />
              : <span className="w-1.5 h-1.5 rounded-full" style={{ background: agentColor }} />}
            <span className="font-medium uppercase tracking-wider">{agentStatus.state}</span>
            {currentTask && <span className="truncate max-w-24 opacity-70">{currentTask.title}</span>}
          </div>

          <button
            onClick={() => { setShowCreate((v) => !v); setEditingId(null); }}
            type="button"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-semibold transition-all"
            style={{
              background: showCreate ? "rgba(30,45,74,0.5)" : "rgba(0,255,136,0.12)",
              color: showCreate ? "#94a3b8" : "#00ff88",
              border: `1px solid ${showCreate ? "rgba(30,45,74,0.7)" : "rgba(0,255,136,0.3)"}`,
            }}
          >
            {showCreate ? "✕ Cancel" : "+ New Task"}
          </button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <TaskForm
          submitLabel="Create Task"
          onSubmit={createTask}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* How it works info */}
      {!showCreate && tasks.length === 0 && !loading && (
        <div
          className="card p-5 text-sm flex flex-col gap-2"
          style={{ border: "1px solid #1e2d4a", color: "#4a5568" }}
        >
          <div className="font-semibold" style={{ color: "#94a3b8" }}>How it works</div>
          <ul className="space-y-1.5 text-xs leading-relaxed" style={{ color: "#4a5568" }}>
            <li><span style={{ color: "#00d4ff" }}>Coding tasks</span> — the scheduler passes your prompt directly to <span style={{ color: "#ffd700" }}>opencode</span> or <span style={{ color: "#00d4ff" }}>claude code</span> CLI in your workspace.</li>
            <li><span style={{ color: "#a855f7" }}>Research tasks</span> — the scheduler calls the <span style={{ color: "#a855f7" }}>Anthropic / OpenAI API</span> directly with your prompt.</li>
            <li><span style={{ color: "#f97316" }}>Rate limited?</span> — the scheduler stops, then retries automatically every hour until usage is available again.</li>
          </ul>
        </div>
      )}

      {/* Tabs */}
      {tasks.length > 0 && (
        <div className="flex gap-1 border-b overflow-x-auto" style={{ borderColor: "#1e2d4a" }}>
          {([
            { key: "active", label: `Active (${active.length})` },
            { key: "all",    label: `All (${tasks.length})` },
          ] as const).map(({ key, label }) => (
            <button
              key={key} onClick={() => setTab(key)} type="button"
              className="px-4 py-2 text-sm font-medium transition-colors relative"
              style={{
                color: tab === key ? "#e2e8f0" : "#4a5568",
                borderBottom: tab === key ? "2px solid #00ff88" : "2px solid transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Task list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="skeleton h-3 w-3 rounded-full" />
                <div className="skeleton h-4 rounded" style={{ width: "55%" }} />
                <div className="skeleton h-5 rounded ml-auto" style={{ width: "15%" }} />
              </div>
              <div className="skeleton h-3 rounded" style={{ width: "80%" }} />
              <div className="skeleton h-3 rounded" style={{ width: "40%" }} />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3 fade-in">
          {displayed.length === 0 ? (
            <div className="card flex flex-col items-center justify-center py-16 gap-3" style={{ color: "#4a5568" }}>
              <svg className="w-12 h-12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <title>No tasks</title>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              <div className="text-sm">
                {tab === "active" ? "No active tasks — create one above" : "No tasks yet"}
              </div>
            </div>
          ) : (
            displayed
              .slice()
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
              .map((task, i) => (
                <div key={task.id} className="slide-up" style={{ "--i": i } as React.CSSProperties}>
                  <TaskRow
                    task={task}
                    isEditing={editingId === task.id}
                    onEdit={() => { setShowCreate(false); setEditingId(editingId === task.id ? null : task.id); }}
                    onDelete={() => deleteTask(task.id)}
                    onQueueNow={() => queueNow(task.id)}
                    onViewReport={() => setReportTask(task)}
                    onSaveEdit={(payload) => saveEdit(task.id, payload)}
                    onCancelEdit={() => setEditingId(null)}
                  />
                </div>
              ))
          )}
        </div>
      )}

      {/* Report modal */}
      {reportTask && <ReportModal task={reportTask} onClose={() => setReportTask(null)} />}
    </div>
  );
}
