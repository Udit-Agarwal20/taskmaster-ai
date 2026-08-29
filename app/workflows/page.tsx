"use client";

import React, { useEffect, useState } from "react";
import { AppShell } from "../../components/layout/AppShell";
import { ActionExplanationPanel } from "../../components/actions/ActionExplanationPanel";
import { buildActionExplanations } from "../../lib/models/action-explanation";

interface WorkflowStep {
  stepNumber: number;
  stepType: string;
  toolName?: string;
  createdAt: string;
}

interface ApprovalRecord {
  id: string;
  action: string;
  riskLevel: string;
  status: string;
  approvedBy?: string;
  createdAt: string;
  resolvedAt?: string;
}

interface WorkflowRun {
  id: string;
  projectId: string;
  goal: string;
  triggerType: string;
  triggerId?: string | null;
  state: string;
  currentStep?: string;
  waitingReason?: string;
  summary?: string;
  plan?: any;
  contextSnapshot?: any;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  durationMs: number;
  stepsCount: number;
  steps: WorkflowStep[];
  approvals: ApprovalRecord[];
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

  async function loadWorkflows() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/workflows?projectId=student-marketplace&limit=50");
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.workflows)) {
        setWorkflows(data.workflows);
        // Expand first run by default if available
        if (data.workflows.length > 0 && !expandedRunId) {
          setExpandedRunId(data.workflows[0].id);
        }
      } else {
        setWorkflows([]);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load workflow history");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWorkflows();
  }, []);

  const totalRuns = workflows.length;
  const completedRuns = workflows.filter((w) => w.state === "COMPLETED").length;
  const pendingApprovals = workflows.filter(
    (w) => w.state === "WAITING_FOR_APPROVAL"
  ).length;

  const LIFECYCLE_STAGES = [
    "UNDERSTANDING",
    "PLANNING",
    "WAITING_FOR_APPROVAL",
    "RESUMING",
    "EXECUTING",
    "VERIFYING",
    "COMPLETED",
  ];

  function getStateIndex(state: string): number {
    const idx = LIFECYCLE_STAGES.indexOf(state);
    return idx >= 0 ? idx : state === "FAILED" ? -1 : 1;
  }

  function formatDuration(ms: number) {
    if (!ms || ms <= 0) return "—";
    const sec = Math.round(ms / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}m ${rem}s`;
  }

  return (
    <AppShell pageTitle="Workflow History — Student Marketplace">
      <div className="tm-content">
        {/* Metric Summary */}
        <div className="tm-health" style={{ marginBottom: 4 }}>
          <div className="tm-stat">
            <div className="tm-stat-value" style={{ color: "var(--text)" }}>
              {totalRuns}
            </div>
            <div className="tm-stat-label">Total Workflow Runs</div>
          </div>
          <div className="tm-stat">
            <div className="tm-stat-value" style={{ color: "var(--success)" }}>
              {completedRuns}
            </div>
            <div className="tm-stat-label">Completed Runs</div>
          </div>
          <div className="tm-stat">
            <div className="tm-stat-value" style={{ color: "var(--warning)" }}>
              {pendingApprovals}
            </div>
            <div className="tm-stat-label">Awaiting Approval</div>
          </div>
          <div className="tm-stat">
            <div className="tm-stat-value" style={{ color: "var(--blue)" }}>
              Gemini 3.5 Flash
            </div>
            <div className="tm-stat-label">Active AI Model (Vertex AI)</div>
          </div>
        </div>

        {/* Workflows List Card */}
        <div className="tm-card">
          <div className="tm-card-header">
            <div>
              <div className="tm-card-title">Durable Workflow Execution History</div>
              <div className="tm-muted" style={{ marginTop: 3, fontSize: 12 }}>
                Persisted runs, deterministic state machines & audit trails from PostgreSQL
              </div>
            </div>
            <button
              className="tm-btn-refresh"
              onClick={loadWorkflows}
              disabled={loading}
              title="Refresh workflows from PostgreSQL"
            >
              {loading ? "Refreshing…" : "↻ Refresh"}
            </button>
          </div>

          {loading ? (
            <div className="tm-loading-state" style={{ padding: "48px 20px" }}>
              <div className="tm-spinner" />
              <span>Loading persisted workflow history from PostgreSQL…</span>
            </div>
          ) : error ? (
            <div className="tm-error-state">
              <div className="tm-error-title">Failed to load workflow history</div>
              <div className="tm-error-msg">{error}</div>
              <button className="tm-btn-retry" onClick={loadWorkflows}>
                Retry
              </button>
            </div>
          ) : workflows.length === 0 ? (
            <div className="tm-empty-state" style={{ padding: "48px 20px" }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>📜</div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>No Workflow Runs Yet</div>
              <div className="tm-muted" style={{ fontSize: 13, marginTop: 4 }}>
                Trigger an autonomous workflow from GitHub or run Taskmaster from the Command Center.
              </div>
            </div>
          ) : (
            <div className="tm-workflow-list">
              {workflows.map((run) => {
                const isExpanded = expandedRunId === run.id;
                const stateIndex = getStateIndex(run.state);
                const runActionExplanations = buildActionExplanations({
                  run,
                  plan: run.plan,
                  approvals: run.approvals,
                });

                return (
                  <div
                    key={run.id}
                    className={`tm-workflow-card ${isExpanded ? "expanded" : ""}`}
                  >
                    {/* Header Row */}
                    <div
                      className="tm-workflow-summary-row"
                      onClick={() =>
                        setExpandedRunId(isExpanded ? null : run.id)
                      }
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                    >
                      <div className="tm-workflow-left">
                        <span
                          className={`tm-source-badge ${
                            run.triggerType.includes("GITHUB")
                              ? "github"
                              : "taskmaster"
                          }`}
                        >
                          {run.triggerType.replace(/_/g, " ")}
                        </span>
                        <span className="tm-workflow-id">{run.id.slice(0, 8)}…</span>
                        <span className="tm-workflow-goal">{run.goal}</span>
                      </div>

                      <div className="tm-workflow-right">
                        <span
                          className="tm-chip"
                          style={{
                            background:
                              run.state === "COMPLETED"
                                ? "var(--success-bg)"
                                : run.state === "WAITING_FOR_APPROVAL"
                                ? "var(--warning-bg)"
                                : run.state === "FAILED"
                                ? "var(--danger-bg)"
                                : "var(--blue-bg)",
                            color:
                              run.state === "COMPLETED"
                                ? "var(--success)"
                                : run.state === "WAITING_FOR_APPROVAL"
                                ? "var(--warning)"
                                : run.state === "FAILED"
                                ? "var(--danger)"
                                : "var(--blue)",
                          }}
                        >
                          ● {run.state.replace(/_/g, " ")}
                        </span>

                        <span className="tm-workflow-time">
                          {formatDuration(run.durationMs)}
                        </span>

                        <span className="tm-workflow-chevron">
                          {isExpanded ? "▲" : "▼"}
                        </span>
                      </div>
                    </div>

                    {/* Expanded Detail Panel */}
                    {isExpanded && (
                      <div className="tm-workflow-details">
                        {/* State Pipeline */}
                        <div className="tm-pipeline-container">
                          <div className="tm-pipeline-label">Workflow Lifecycle Progression:</div>
                          <div className="tm-pipeline-steps">
                            {LIFECYCLE_STAGES.map((stage, idx) => {
                              const isCurrent = run.state === stage;
                              const isPassed = stateIndex > idx && run.state !== "FAILED";

                              return (
                                <div
                                  key={stage}
                                  className={`tm-pipeline-step ${
                                    isCurrent
                                      ? "current"
                                      : isPassed
                                      ? "passed"
                                      : "upcoming"
                                  }`}
                                >
                                  <div className="tm-step-dot" />
                                  <span className="tm-step-name">{stage}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Summary & Reasoning */}
                        {run.summary && (
                          <div className="tm-workflow-section">
                            <div className="tm-section-title">Agent Summary & Diagnosis:</div>
                            <div className="tm-section-content">{run.summary}</div>
                          </div>
                        )}

                        {/* Proof of Work Layer for this Run */}
                        {runActionExplanations.length > 0 && (
                          <div className="tm-workflow-section">
                            <div className="tm-section-title">
                              Proof of Work & Action Explanation ({runActionExplanations.length}):
                            </div>
                            <ActionExplanationPanel actions={runActionExplanations} />
                          </div>
                        )}

                        {/* Approvals */}
                        {run.approvals.length > 0 && (
                          <div className="tm-workflow-section">
                            <div className="tm-section-title">Governance & Approvals:</div>
                            {run.approvals.map((appr) => (
                              <div key={appr.id} className="tm-approval-item">
                                <div>
                                  <strong>Action:</strong> {appr.action} ·{" "}
                                  <strong>Risk Level:</strong> {appr.riskLevel}
                                </div>
                                <div className="tm-muted" style={{ fontSize: 12, marginTop: 2 }}>
                                  Status: <strong>{appr.status.toUpperCase()}</strong>
                                  {appr.approvedBy && ` by ${appr.approvedBy}`}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Audit Steps */}
                        <div className="tm-workflow-section">
                          <div className="tm-section-title">
                            PostgreSQL Step Audit Trail ({run.steps.length} steps):
                          </div>
                          <div className="tm-steps-trail">
                            {run.steps.map((st) => (
                              <div key={st.stepNumber} className="tm-step-trail-item">
                                <span className="tm-step-num">Step {st.stepNumber}</span>
                                <span className="tm-step-badge">{st.stepType}</span>
                                <span className="tm-step-tool">
                                  {st.toolName || "(plan output / synthesis)"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Run Metadata Footer */}
                        <div className="tm-workflow-meta-footer">
                          <span>
                            <strong>Run ID:</strong> {run.id}
                          </span>
                          {run.startedAt && (
                            <span>
                              <strong>Started:</strong>{" "}
                              {new Date(run.startedAt).toLocaleString()}
                            </span>
                          )}
                          {run.completedAt && (
                            <span>
                              <strong>Completed:</strong>{" "}
                              {new Date(run.completedAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
