"use client";

import React, { useState } from "react";

export interface TaskItem {
  id: string;
  title: string;
  status: "todo" | "doing" | "review" | "done";
  priority: "low" | "medium" | "high";
  assignee: string;
  dueDate: string;
  blocked: boolean;
  parentTaskId?: string | null;
  isAiCreated?: boolean;
}

interface TaskBoardProps {
  tasks: TaskItem[];
  loading?: boolean;
  showSearch?: boolean;
}

const COLUMNS = [
  ["todo", "Todo"],
  ["doing", "Doing"],
  ["review", "Review"],
  ["done", "Done"],
] as const;

export function TaskBoard({ tasks, loading = false, showSearch = false }: TaskBoardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterAssignee, setFilterAssignee] = useState<string>("all");

  // Unique assignees list
  const assignees = Array.from(new Set(tasks.map((t) => t.assignee))).filter(Boolean);

  const filteredTasks = tasks.filter((t) => {
    const matchesSearch =
      searchQuery.trim() === "" ||
      t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.assignee.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesAssignee =
      filterAssignee === "all" || t.assignee === filterAssignee;

    return matchesSearch && matchesAssignee;
  });

  return (
    <div className="tm-taskboard-container">
      {showSearch && (
        <div className="tm-taskboard-filters">
          <div className="tm-search-box">
            <input
              type="text"
              placeholder="Search tasks by title or assignee…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="tm-input-search"
            />
            {searchQuery && (
              <button
                className="tm-btn-clear"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="tm-filter-group">
            <label htmlFor="assignee-select" className="tm-filter-label">
              Assignee:
            </label>
            <select
              id="assignee-select"
              value={filterAssignee}
              onChange={(e) => setFilterAssignee(e.target.value)}
              className="tm-select"
            >
              <option value="all">All Team ({tasks.length})</option>
              {assignees.map((a) => (
                <option key={a} value={a}>
                  {a} ({tasks.filter((t) => t.assignee === a).length})
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="tm-loading-state">
          <div className="tm-spinner" />
          <span>Loading live project tasks from Neon PostgreSQL…</span>
        </div>
      ) : (
        <div className="tm-board">
          {COLUMNS.map(([statusKey, label]) => {
            const colTasks = filteredTasks.filter((t) => t.status === statusKey);

            return (
              <div className="tm-column" key={statusKey}>
                <div className="tm-column-header">
                  <span>{label}</span>
                  <span className="tm-column-count">{colTasks.length}</span>
                </div>

                <div className="tm-tasks-list">
                  {colTasks.length === 0 ? (
                    <div className="tm-task-empty">No tasks in {label}</div>
                  ) : (
                    colTasks.map((task) => (
                      <div
                        className={`tm-task ${task.isAiCreated ? "ai-created" : ""}`}
                        key={task.id}
                      >
                        <div className="tm-task-title">{task.title}</div>
                        <div className="tm-task-meta">
                          <span className="tm-chip">
                            {task.assignee} · {task.dueDate}
                          </span>
                          {task.priority === "high" && (
                            <span className="tm-chip high">High</span>
                          )}
                          {task.blocked && (
                            <span className="tm-chip blocked">Blocked</span>
                          )}
                          {task.isAiCreated && (
                            <span className="tm-chip ai">AI Subtask</span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
