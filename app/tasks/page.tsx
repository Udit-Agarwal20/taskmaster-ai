"use client";

import React, { useEffect, useState } from "react";
import { AppShell } from "../../components/layout/AppShell";
import { TaskBoard, TaskItem } from "../../components/tasks/TaskBoard";

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadTasks() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects/student-marketplace/tasks");
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();

      if (Array.isArray(data)) {
        setTasks(
          data.map((t: any) => ({
            id: t.id,
            title: t.title,
            status: t.status,
            priority: t.priority,
            assignee: t.assignee || "Unassigned",
            dueDate: t.dueDate || "No deadline",
            blocked: Boolean(t.blocked),
            parentTaskId: t.parentTaskId,
            isAiCreated:
              t.id.startsWith("subtask-") ||
              t.description?.includes("Taskmaster") ||
              Boolean(t.parentTaskId),
          }))
        );
      } else {
        setTasks([]);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load project tasks");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTasks();
  }, []);

  const totalTasks = tasks.length;
  const blockedTasks = tasks.filter((t) => t.blocked).length;
  const inProgressTasks = tasks.filter(
    (t) => t.status === "doing" || t.status === "review"
  ).length;
  const doneTasks = tasks.filter((t) => t.status === "done").length;
  const aiSubtasks = tasks.filter((t) => t.isAiCreated).length;

  return (
    <AppShell pageTitle="Project Tasks — Student Marketplace">
      <div className="tm-content">
        {/* Header Summary Cards */}
        <div className="tm-health" style={{ marginBottom: 4 }}>
          <div className="tm-stat">
            <div className="tm-stat-value" style={{ color: "var(--text)" }}>
              {totalTasks}
            </div>
            <div className="tm-stat-label">Total Persisted Tasks</div>
          </div>
          <div className="tm-stat">
            <div className="tm-stat-value" style={{ color: "var(--blue)" }}>
              {inProgressTasks}
            </div>
            <div className="tm-stat-label">In Progress / Review</div>
          </div>
          <div className="tm-stat">
            <div className="tm-stat-value" style={{ color: "var(--danger)" }}>
              {blockedTasks}
            </div>
            <div className="tm-stat-label">Blocked Tasks</div>
          </div>
          <div className="tm-stat">
            <div className="tm-stat-value" style={{ color: "var(--accent)" }}>
              {aiSubtasks}
            </div>
            <div className="tm-stat-label">AI-Created Subtasks</div>
          </div>
        </div>

        {/* Task Board Card */}
        <div className="tm-card">
          <div className="tm-card-header">
            <div>
              <div className="tm-card-title">Live Task Board</div>
              <div className="tm-muted" style={{ marginTop: 3, fontSize: 12 }}>
                Real-time synchronized with Neon PostgreSQL database
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button
                className="tm-btn-refresh"
                onClick={loadTasks}
                disabled={loading}
                title="Refresh tasks from PostgreSQL"
              >
                {loading ? "Refreshing…" : "↻ Refresh"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="tm-error-state">
              <div className="tm-error-title">Failed to load tasks</div>
              <div className="tm-error-msg">{error}</div>
              <button className="tm-btn-retry" onClick={loadTasks}>
                Retry
              </button>
            </div>
          ) : (
            <div style={{ padding: "20px" }}>
              <TaskBoard tasks={tasks} loading={loading} showSearch={true} />
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
