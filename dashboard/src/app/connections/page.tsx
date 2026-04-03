"use client";

import { useEffect, useState, useCallback } from "react";

interface Worktree {
  id: string;
  name: string;
  path: string;
  branch: string;
  projectId: string;
}

interface Connection {
  id: string;
  sourceWorktreeId: string;
  targetWorktreeId: string;
  type: string;
  notes: string | null;
  createdAt: string;
  sourceWorktree?: Worktree;
  targetWorktree?: Worktree;
}

const CONNECTION_TYPES = [
  { value: "depends-on", label: "Depends On" },
  { value: "related", label: "Related" },
  { value: "blocks", label: "Blocks" },
  { value: "duplicates", label: "Duplicates" },
  { value: "parent", label: "Parent" },
  { value: "child", label: "Child" },
];

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewConnection, setShowNewConnection] = useState(false);
  const [editingNotes, setEditingNotes] = useState<string | null>(null);
  const [newConnection, setNewConnection] = useState({
    sourceWorktreeId: "",
    targetWorktreeId: "",
    type: "related",
    notes: "",
  });

  const loadConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/connections");
      const data = await res.json();
      setConnections(data.connections || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadWorktrees = useCallback(async () => {
    try {
      const res = await fetch("/api/worktrees");
      const data = await res.json();
      setWorktrees(data.worktrees || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    loadConnections();
    loadWorktrees();
  }, [loadConnections, loadWorktrees]);

  const handleCreateConnection = async () => {
    if (!newConnection.sourceWorktreeId || !newConnection.targetWorktreeId) return;
    try {
      const res = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConnection),
      });
      if (res.ok) {
        setNewConnection({ sourceWorktreeId: "", targetWorktreeId: "", type: "related", notes: "" });
        setShowNewConnection(false);
        loadConnections();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDeleteConnection = async (id: string) => {
    try {
      await fetch(`/api/connections/${id}`, { method: "DELETE" });
      loadConnections();
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateNotes = async (id: string, notes: string) => {
    try {
      await fetch(`/api/connections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      setEditingNotes(null);
      loadConnections();
    } catch (err) {
      console.error(err);
    }
  };

  const getWorktreeName = (wt?: Worktree) => wt?.name || "Unknown";
  const getWorktreeBranch = (wt?: Worktree) => wt?.branch || "";

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 text-white">
        Loading...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 border-b border-slate-700">
        <h1 className="text-lg font-semibold">Worktree Connections</h1>
        <button
          type="button"
          onClick={() => setShowNewConnection(true)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm"
        >
          + New Connection
        </button>
      </div>

      {showNewConnection && (
        <div className="p-4 bg-slate-800 border-b border-slate-700">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="source-worktree" className="block text-sm text-slate-400 mb-1">Source Worktree</label>
              <select
                id="source-worktree"
                value={newConnection.sourceWorktreeId}
                onChange={(e) => setNewConnection({ ...newConnection, sourceWorktreeId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
              >
                <option value="">Select worktree...</option>
                {worktrees.map((wt) => (
                  <option key={wt.id} value={wt.id}>
                    {wt.name} ({wt.branch})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="target-worktree" className="block text-sm text-slate-400 mb-1">Target Worktree</label>
              <select
                id="target-worktree"
                value={newConnection.targetWorktreeId}
                onChange={(e) => setNewConnection({ ...newConnection, targetWorktreeId: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
              >
                <option value="">Select worktree...</option>
                {worktrees
                  .filter((wt) => wt.id !== newConnection.sourceWorktreeId)
                  .map((wt) => (
                    <option key={wt.id} value={wt.id}>
                      {wt.name} ({wt.branch})
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="connection-type" className="block text-sm text-slate-400 mb-1">Connection Type</label>
              <select
                id="connection-type"
                value={newConnection.type}
                onChange={(e) => setNewConnection({ ...newConnection, type: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
              >
                {CONNECTION_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="connection-notes" className="block text-sm text-slate-400 mb-1">Notes (optional)</label>
              <input
                id="connection-notes"
                type="text"
                value={newConnection.notes}
                onChange={(e) => setNewConnection({ ...newConnection, notes: e.target.value })}
                placeholder="Add notes..."
                className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCreateConnection}
              disabled={!newConnection.sourceWorktreeId || !newConnection.targetWorktreeId}
              className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded text-sm disabled:opacity-50"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowNewConnection(false)}
              className="px-4 py-2 bg-slate-600 hover:bg-slate-500 rounded text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {connections.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-slate-400">
            <p>No connections yet</p>
            <p className="text-sm mt-1">Create connections between worktrees to track relationships</p>
          </div>
        ) : (
          <div className="space-y-3">
            {connections.map((conn) => (
              <div key={conn.id} className="bg-slate-800 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col items-center px-3 py-2 bg-slate-700 rounded">
                      <span className="text-sm font-medium text-blue-400">
                        {getWorktreeName(conn.sourceWorktree)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {getWorktreeBranch(conn.sourceWorktree)}
                      </span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-xs text-slate-500 mb-1">
                        {CONNECTION_TYPES.find((t) => t.value === conn.type)?.label || conn.type}
                      </span>
                      <span className="text-slate-400">→</span>
                    </div>
                    <div className="flex flex-col items-center px-3 py-2 bg-slate-700 rounded">
                      <span className="text-sm font-medium text-green-400">
                        {getWorktreeName(conn.targetWorktree)}
                      </span>
                      <span className="text-xs text-slate-500">
                        {getWorktreeBranch(conn.targetWorktree)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteConnection(conn.id)}
                    className="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-slate-700 rounded"
                  >
                    Delete
                  </button>
                </div>
                {conn.notes && (
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <p className="text-sm text-slate-400">{conn.notes}</p>
                  </div>
                )}
                {editingNotes === conn.id ? (
                  <div className="mt-3 pt-3 border-t border-slate-700">
                    <input
                      type="text"
                      defaultValue={conn.notes || ""}
                      placeholder="Add notes..."
                      className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded text-sm mb-2"
                      id={`notes-${conn.id}`}
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const input = document.getElementById(`notes-${conn.id}`) as HTMLInputElement;
                          handleUpdateNotes(conn.id, input.value);
                        }}
                        className="px-3 py-1 text-xs bg-green-600 hover:bg-green-700 rounded"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingNotes(null)}
                        className="px-3 py-1 text-xs bg-slate-600 hover:bg-slate-500 rounded"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setEditingNotes(conn.id)}
                      className="text-xs text-slate-500 hover:text-white"
                    >
                      {conn.notes ? "Edit notes" : "+ Add notes"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
