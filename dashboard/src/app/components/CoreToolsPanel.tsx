"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { PortInfo } from "../page";
import UnexposeModal from "./UnexposeModal";

interface ExposedPort {
  port: number;
  url: string;
}

interface Props {
  ports: PortInfo[];
  loading: boolean;
  publicIp: string;
  onExpose: (port: PortInfo) => void;
  onUnexpose: (port: number) => void;
  refreshToken?: number;
}

type SortKey = "port" | "processName" | "matchedSession";
type SortDir = "asc" | "desc";

const WELL_KNOWN: Record<number, string> = {
  21: "FTP", 22: "SSH", 25: "SMTP", 53: "DNS", 80: "HTTP",
  443: "HTTPS", 3000: "Dev", 3306: "MySQL", 5432: "PostgreSQL",
  6379: "Redis", 7681: "ttyd", 8080: "HTTP Alt", 8443: "HTTPS Alt",
  9200: "Elasticsearch", 27017: "MongoDB",
};

function PortBadge({ port }: { port: number }) {
  const tag = WELL_KNOWN[port];
  if (!tag) return null;
  return (
    <span
      className="badge ml-1"
      style={{
        background: "rgba(255, 215, 0, 0.08)",
        color: "#ffd700",
        border: "1px solid rgba(255, 215, 0, 0.2)",
        fontSize: "0.6rem",
      }}
    >
      {tag}
    </span>
  );
}

export default function CoreToolsPanel({
  ports,
  loading,
  publicIp,
  onExpose,
  onUnexpose,
  refreshToken,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [exposedPorts, setExposedPorts] = useState<ExposedPort[]>([]);
  const [exposedLoading, setExposedLoading] = useState(false);
  const [unexposePort, setUnexposePort] = useState<number | null>(null);
  const [unexposeResult, setUnexposeResult] = useState<{ success: boolean; message: string } | null>(null);
  const [unexposeLoading, setUnexposeLoading] = useState(false);
  const [filterText, setFilterText] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("port");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const fetchExposedPorts = useCallback(async () => {
    setExposedLoading(true);
    try {
      const res = await fetch("/api/expose");
      const data = await res.json();
      setExposedPorts(data.ports ?? []);
    } catch {
      setExposedPorts([]);
    } finally {
      setExposedLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExposedPorts();
  }, [fetchExposedPorts, refreshToken]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const filtered = useMemo(() => {
    if (!filterText) return ports;
    const q = filterText.toLowerCase();
    return ports.filter(
      (p) =>
        String(p.port).includes(q) ||
        p.processName.toLowerCase().includes(q) ||
        (p.matchedSession ?? "").toLowerCase().includes(q),
    );
  }, [ports, filterText]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "port") cmp = a.port - b.port;
      else if (sortKey === "processName") cmp = a.processName.localeCompare(b.processName);
      else cmp = (a.matchedSession ?? "").localeCompare(b.matchedSession ?? "");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortKey, sortDir]);

  const SortIndicator = ({ k }: { k: SortKey }) => (
    <svg className="w-3 h-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M19 12l-7 7-7-7" />
    </svg>
  );

  const handleUnexpose = async () => {
    if (unexposePort === null) return;
    setUnexposeLoading(true);
    try {
      const res = await fetch("/api/expose", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: unexposePort }),
      });
      const data = await res.json();
      setUnexposeResult({ success: data.success, message: data.message });
      if (data.success) {
        setExposedPorts((prev) => prev.filter((p) => p.port !== unexposePort));
        onUnexpose(unexposePort);
      }
    } catch {
      setUnexposeResult({ success: false, message: "Failed to contact API" });
    } finally {
      setUnexposeLoading(false);
    }
  };

  return (
    <div
      className="card overflow-hidden"
      style={{ borderLeft: "3px solid #a855f7" }}
    >
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/5"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4"
            style={{ color: "#a855f7" }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
          <h2 className="text-sm font-semibold uppercase tracking-widest" style={{ color: "#a855f7" }}>
            Core Tools
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="badge"
            style={{
              background: "rgba(168, 85, 247, 0.1)",
              color: "#a855f7",
              border: "1px solid rgba(168, 85, 247, 0.2)",
            }}
          >
            {exposedPorts.length} exposed
          </span>
          <svg
            className="w-4 h-4 transition-transform"
            style={{
              color: "#4a5568",
              transform: expanded ? "rotate(0deg)" : "rotate(-90deg)",
            }}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#a855f7" }}>
                Exposed Ports
              </h3>
              <button
                onClick={fetchExposedPorts}
                disabled={exposedLoading}
                className="flex items-center gap-1 text-xs px-2 py-0.5 rounded transition-colors"
                style={{
                  background: "rgba(168, 85, 247, 0.08)",
                  border: "1px solid rgba(168, 85, 247, 0.2)",
                  color: "#a855f7",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(168, 85, 247, 0.15)";
                  e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(168, 85, 247, 0.08)";
                  e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.2)";
                }}
              >
                <svg
                  className={`w-3 h-3 ${exposedLoading ? "animate-spin" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
                Refresh
              </button>
            </div>

            {exposedPorts.length === 0 ? (
              <div
                className="rounded py-6 text-center text-xs"
                style={{ background: "rgba(30, 45, 74, 0.3)", color: "#4a5568" }}
              >
                No ports currently exposed
              </div>
            ) : (
              <div className="space-y-1.5">
                {exposedPorts.map((ep) => (
                  <div
                    key={ep.port}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded"
                    style={{
                      background: "rgba(168, 85, 247, 0.06)",
                      border: "1px solid rgba(168, 85, 247, 0.15)",
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono font-semibold text-sm" style={{ color: "#a855f7" }}>
                        :{ep.port}
                      </span>
                      <PortBadge port={ep.port} />
                      <span className="text-xs truncate font-mono" style={{ color: "#94a3b8" }}>
                        {ep.url}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setUnexposePort(ep.port);
                        setUnexposeResult(null);
                      }}
                      className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium flex-shrink-0 transition-all"
                      style={{
                        background: "rgba(255, 68, 68, 0.08)",
                        border: "1px solid rgba(255, 68, 68, 0.2)",
                        color: "#ff6b6b",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "rgba(255, 68, 68, 0.18)";
                        e.currentTarget.style.borderColor = "rgba(255, 68, 68, 0.5)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "rgba(255, 68, 68, 0.08)";
                        e.currentTarget.style.borderColor = "rgba(255, 68, 68, 0.2)";
                      }}
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                      Stop
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#4a5568" }}>
                Listening Ports
              </h3>
              <div className="relative">
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3"
                  style={{ color: "#4a5568" }}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Filter…"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  className="pl-7 pr-3 py-1 rounded text-xs outline-none"
                  style={{
                    background: "rgba(30, 45, 74, 0.5)",
                    border: "1px solid rgba(30, 45, 74, 0.8)",
                    color: "#e2e8f0",
                    width: "120px",
                    transitionProperty: "width",
                    transitionDuration: "200ms",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(168, 85, 247, 0.4)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(30, 45, 74, 0.8)")}
                />
              </div>
            </div>

            <div className="overflow-x-auto rounded" style={{ border: "1px solid rgba(30, 45, 74, 0.8)" }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>
                      <button
                        className="flex items-center gap-1 hover:text-purple-400 transition-colors"
                        onClick={() => handleSort("port")}
                        style={{ color: sortKey === "port" ? "#a855f7" : undefined }}
                      >
                        Port <SortIndicator k="port" />
                      </button>
                    </th>
                    <th>
                      <button
                        className="flex items-center gap-1 hover:text-purple-400 transition-colors"
                        onClick={() => handleSort("processName")}
                        style={{ color: sortKey === "processName" ? "#a855f7" : undefined }}
                      >
                        Process <SortIndicator k="processName" />
                      </button>
                    </th>
                    <th>PID</th>
                    <th>
                      <button
                        className="flex items-center gap-1 hover:text-purple-400 transition-colors"
                        onClick={() => handleSort("matchedSession")}
                        style={{ color: sortKey === "matchedSession" ? "#a855f7" : undefined }}
                      >
                        Session <SortIndicator k="matchedSession" />
                      </button>
                    </th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p) => (
                    <tr key={p.port}>
                      <td>
                        <div className="flex items-center gap-1">
                          <span
                            className="font-mono font-semibold text-sm"
                            style={{ color: p.port < 1024 ? "#ffd700" : "#00d4ff" }}
                          >
                            {p.port}
                          </span>
                          <PortBadge port={p.port} />
                        </div>
                      </td>
                      <td>
                        <span className="font-mono text-xs" style={{ color: "#e2e8f0" }}>
                          {p.processName}
                        </span>
                      </td>
                      <td>
                        <span className="font-mono text-xs" style={{ color: "#94a3b8" }}>
                          {p.pid ?? "—"}
                        </span>
                      </td>
                      <td>
                        {p.matchedSession ? (
                          <span
                            className="badge"
                            style={{
                              background: "rgba(0, 255, 136, 0.1)",
                              color: "#00ff88",
                              border: "1px solid rgba(0, 255, 136, 0.2)",
                            }}
                          >
                            {p.matchedSession}
                          </span>
                        ) : (
                          <span className="text-xs" style={{ color: "#2e4a7a" }}>—</span>
                        )}
                      </td>
                      <td>
                        <button
                          onClick={() => onExpose(p)}
                          className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all"
                          style={{
                            background: "rgba(0, 212, 255, 0.08)",
                            border: "1px solid rgba(0, 212, 255, 0.2)",
                            color: "#00d4ff",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "rgba(0, 212, 255, 0.18)";
                            e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.5)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "rgba(0, 212, 255, 0.08)";
                            e.currentTarget.style.borderColor = "rgba(0, 212, 255, 0.2)";
                          }}
                        >
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                          Expose
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {unexposePort !== null && (
        <UnexposeModal
          port={unexposePort}
          result={unexposeResult}
          loading={unexposeLoading}
          publicIp={publicIp}
          onClose={() => {
            setUnexposePort(null);
            setUnexposeResult(null);
          }}
          onUnexpose={handleUnexpose}
        />
      )}
    </div>
  );
}
