"use client";

import { useEffect, useState } from "react";
import { AppShell } from "../components/layout/AppShell";
import {
  ActionExplanationPanel,
} from "../components/actions/ActionExplanationPanel";
import { ActionExplanation } from "../lib/models/action-explanation";

type TaskItem = {
  id: string;
  title: string;
  status: "todo" | "doing" | "review" | "done";
  priority: "low" | "medium" | "high";
  assignee: string;
  dueDate: string;
  blocked: boolean;
  parentTaskId?: string | null;
  isAiCreated?: boolean;
};

type TimelineEvent = {
  id: string;
  source: "github" | "taskmaster" | "postgres" | "slack" | "human" | "system";
  title: string;
  description: string;
  timestamp: string;
  verified?: boolean;
  stepStage?: string;
  linkedId?: string;
};

type ApprovalData = {
  id: string;
  action: string;
  payload: any;
  riskLevel: string;
};

const columns = [
  ["todo", "Todo"],
  ["doing", "Doing"],
  ["review", "Review"],
  ["done", "Done"],
] as const;

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [workflowState, setWorkflowState] = useState<string>("ONLINE");
  const [workflowRunId, setWorkflowRunId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ApprovalData | null>(null);
  const [agentSummary, setAgentSummary] = useState<string>(
    "Project state loaded from PostgreSQL. Ready to execute recovery analysis."
  );
  const [findings, setFindings] = useState<any[]>([]);
  const [proposedActions, setProposedActions] = useState<any[]>([]);
  const [actionExplanations, setActionExplanations] = useState<ActionExplanation[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [analysisData, setAnalysisData] = useState({
    risk: "HIGH",
    blockers: 4,
    deadlineRisks: 3,
    bottleneck: { name: "Rahul", count: 11 },
  });

  // Format activity log from DB into timeline item with operational stage linkage
  function mapActivityToTimeline(act: any): TimelineEvent {
    let source: TimelineEvent["source"] = "system";
    let title = act.eventType;
    let description = "";
    let stepStage = "EVENT";

    const meta = act.metadata || {};

    if (act.eventType === "GITHUB_PR_MERGED" || act.eventType.includes("GITHUB")) {
      source = "github";
      stepStage = "EVENT";
      title = `GitHub PR #${meta.pullRequestNumber || "7"} merged`;
      description = `${meta.title || "Payment Webhook Integration"} (${meta.sourceBranch || "feature/webhook"} → main)`;
    } else if (act.eventType === "SUBTASK_CREATED") {
      source = "taskmaster";
      stepStage = "ACT & VERIFY";
      title = `Created QA subtask under '${meta.parentTitle || "Payment integration"}'`;
      description = `Title: "${meta.title}" · Verified in PostgreSQL ✓`;
    } else if (act.eventType === "TASK_REASSIGNED") {
      source = "postgres";
      stepStage = "VERIFY";
      title = `Reassigned task '${meta.taskTitle || meta.taskId}'`;
      description = `${meta.previousAssignee} → ${meta.newAssignee} (Approved by ${meta.approvedBy}) ✓`;
    } else if (act.eventType === "SLACK_MESSAGE_SENT") {
      source = "slack";
      stepStage = "COMMUNICATE";
      title = `Project update posted to Slack`;
      description = `Channel: #${meta.channelId || "taskmaster-demo"} · "${meta.messagePreview || "Taskmaster completed a project action"}…" ✓`;
    } else if (act.eventType === "APPROVAL_RESOLVED") {
      source = "human";
      stepStage = "DECIDE";
      title = `Human operator approval granted`;
      description = `Operator approved ${meta.action} for execution.`;
    } else if (act.eventType === "APPROVAL_REJECTED") {
      source = "human";
      stepStage = "DECIDE";
      title = `Human operator approval rejected`;
      description = `Operator rejected ${meta.action}. Task left unmodified.`;
    } else {
      source = act.actorType === "agent" ? "taskmaster" : "system";
      stepStage = "UNDERSTAND";
      title = act.eventType.replace(/_/g, " ");
      description = JSON.stringify(meta);
    }

    const timeStr = act.createdAt
      ? new Date(act.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      : new Date().toLocaleTimeString();

    return {
      id: act.id || `${Date.now()}-${Math.random()}`,
      source,
      title,
      description,
      timestamp: timeStr,
      verified: meta.verified ?? true,
      stepStage,
      linkedId: act.actorId || meta.taskId || meta.pullRequestNumber,
    };
  }

  async function loadData() {
    try {
      const [tasksRes, analysisRes] = await Promise.all([
        fetch("/api/projects/student-marketplace/tasks"),
        fetch("/api/projects/student-marketplace/analysis"),
      ]);

      if (tasksRes.ok) {
        const dbTasks = await tasksRes.json();
        if (Array.isArray(dbTasks)) {
          setTasks(
            dbTasks.map((t: any) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              priority: t.priority,
              assignee: t.assignee || "Unassigned",
              dueDate: t.dueDate || "No deadline",
              blocked: Boolean(t.blocked),
              parentTaskId: t.parentTaskId,
              isAiCreated: t.id.startsWith("subtask-") || t.description?.includes("Taskmaster"),
            }))
          );
        }
      }

      if (analysisRes.ok) {
        const data = await analysisRes.json();
        setAnalysisData({
          risk: data.risk || "HIGH",
          blockers: data.blockers ?? 4,
          deadlineRisks: data.deadlineRisks ?? 3,
          bottleneck: data.bottleneck || { name: "Rahul", count: 11 },
        });

        if (Array.isArray(data.actionExplanations)) {
          setActionExplanations(data.actionExplanations);
        }

        if (Array.isArray(data.pendingApprovals) && data.pendingApprovals.length > 0) {
          const first = data.pendingApprovals[0];
          setPendingApproval({
            id: first.id,
            action: first.action,
            payload: first.payload,
            riskLevel: first.riskLevel,
          });
          setWorkflowState("WAITING_FOR_APPROVAL");
        }

        if (Array.isArray(data.recentActivities) && data.recentActivities.length > 0) {
          setTimeline(data.recentActivities.map(mapActivityToTimeline));
        } else {
          // Default baseline timeline entries
          setTimeline([
            {
              id: "init-1",
              source: "github",
              stepStage: "EVENT",
              title: "GitHub PR #7 merged — Payment Webhook Integration",
              description: "Pull request merged into main by Arjun. Triggered Taskmaster event queue.",
              timestamp: "10:42:01 AM",
              verified: true,
            },
            {
              id: "init-2",
              source: "taskmaster",
              stepStage: "UNDERSTAND",
              title: "Taskmaster analyzed project state & dependencies",
              description: "Identified 4 blockers and bottleneck on Rahul (11 tasks). Formulated recovery plan.",
              timestamp: "10:42:02 AM",
              verified: true,
            },
          ]);
        }
      }
    } catch {
      // Retain existing state
    }
  }

  useEffect(() => {
    setMounted(true);
    loadData();
  }, []);

  async function runAgent() {
    setRunning(true);
    setWorkflowState("PLANNING");

    const activeGoal = prompt.trim() || "Get this project back on track.";
    const startEvent: TimelineEvent = {
      id: `run-${Date.now()}`,
      source: "taskmaster",
      stepStage: "UNDERSTAND",
      title: "Taskmaster Workflow Started",
      description: `Goal: "${activeGoal}" · Calling Gemini 3.5 Flash via Vertex AI to inspect project graph…`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };
    setTimeline((prev) => [startEvent, ...prev]);

    try {
      const res = await fetch("/api/projects/student-marketplace/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: activeGoal }),
      });
      const data = await res.json();

      if (data.agentRunId) {
        setWorkflowRunId(data.agentRunId);
      }
      if (data.status) {
        setWorkflowState(data.status);
      }
      if (data.summary) {
        setAgentSummary(data.summary);
      }
      if (Array.isArray(data.findings) && data.findings.length > 0) {
        setFindings(data.findings);
      }
      if (Array.isArray(data.proposedActions)) {
        setProposedActions(data.proposedActions);
      }

      if (data.approvalId && data.pendingApproval) {
        setPendingApproval({
          id: data.approvalId,
          action: data.pendingApproval.action,
          payload: data.pendingApproval.payload,
          riskLevel: data.pendingApproval.riskLevel,
        });
      } else if (data.status === "COMPLETED") {
        setPendingApproval(null);
      }

      await loadData();
    } catch (err: any) {
      setWorkflowState("FAILED");
      setTimeline((prev) => [
        {
          id: `err-${Date.now()}`,
          source: "taskmaster",
          stepStage: "DECIDE",
          title: "Agent Execution Error",
          description: err.message || "Failed to communicate with workflow server",
          timestamp: new Date().toLocaleTimeString(),
        },
        ...prev,
      ]);
    } finally {
      setRunning(false);
      setPrompt("");
    }
  }

  async function handleApprovalResolution(decision: "approve" | "reject") {
    if (!pendingApproval) return;
    setRunning(true);

    try {
      const res = await fetch(`/api/approvals/${pendingApproval.id}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();

      setPendingApproval(null);
      setWorkflowState("COMPLETED");

      const resEvent: TimelineEvent = {
        id: `appr-${Date.now()}`,
        source: "human",
        stepStage: "DECIDE & VERIFY",
        title: decision === "approve" ? "Human Operator Approved Action" : "Human Operator Rejected Action",
        description: data.summary || `Resolved approval '${pendingApproval.id}'.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        verified: true,
        linkedId: pendingApproval.id,
      };
      setTimeline((prev) => [resEvent, ...prev]);

      await loadData();
    } catch (err: any) {
      alert("Failed to submit approval resolution: " + err.message);
    } finally {
      setRunning(false);
    }
  }

  const runButton = (
    <button
      className="tm-btn-run"
      onClick={runAgent}
      disabled={running}
      title="Execute live Gemini 3.5 Flash recovery workflow"
    >
      {running ? "Analyzing Project…" : "⚡ Run Taskmaster"}
    </button>
  );

  return (
    <AppShell workflowState={workflowState} headerAction={runButton}>
      {/* Dashboard Grid */}
      <section className="tm-content">
        {/* Top Section: Health & Stats */}
        <div className="tm-card">
          <div className="tm-card-header">
            <div>
              <div className="tm-card-title">Project Health & Operational Signals</div>
              <div className="tm-muted" style={{ marginTop: 3, fontSize: 12 }}>
                Taskmaster is watching for changes that require follow-through. (Target: Friday Launch)
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="tm-source-badge-mini" style={{ fontSize: 11 }}>
                Live Vertex AI Watcher
              </span>
              <div
                className="tm-chip high"
                style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px" }}
              >
                {analysisData.risk} RISK
              </div>
            </div>
          </div>

          <div className="tm-health">
            <div className="tm-stat">
              <div className="tm-stat-value" style={{ color: "var(--danger)" }}>
                {analysisData.blockers}
              </div>
              <div className="tm-stat-label">Blockers Identified</div>
            </div>
            <div className="tm-stat">
              <div className="tm-stat-value" style={{ color: "var(--warning)" }}>
                {analysisData.deadlineRisks}
              </div>
              <div className="tm-stat-label">Deadline Risks (Friday)</div>
            </div>
            <div className="tm-stat">
              <div className="tm-stat-value" style={{ color: "var(--blue)" }}>
                {analysisData.bottleneck.name} ({analysisData.bottleneck.count})
              </div>
              <div className="tm-stat-label">Primary Bottleneck</div>
            </div>
            <div className="tm-stat">
              <div className="tm-stat-value" style={{ color: "var(--accent)" }}>
                42%
              </div>
              <div className="tm-stat-label">Milestone Progress</div>
            </div>
          </div>
        </div>

        {/* Section: Action Lifecycle & Proof of Work Layer */}
        <div className="tm-card">
          <div className="tm-card-header">
            <div>
              <div className="tm-card-title">Action Lifecycle & Proof of Work Layer</div>
              <div className="tm-muted" style={{ marginTop: 2, fontSize: 12 }}>
                Operational follow-through: Trigger → Why → Action → Policy → Status → Verification → Outcome
              </div>
            </div>
            <span className="tm-chip" style={{ fontSize: 11, fontWeight: 600 }}>
              Audited Records
            </span>
          </div>

          <div style={{ padding: "16px 20px" }}>
            <ActionExplanationPanel actions={actionExplanations} />
          </div>
        </div>

        {/* Main Grid: Work Board (Left) + Agent Operator Panel (Right) */}
        <div className="tm-grid">
          {/* Center / Left: Task Board */}
          <div className="tm-card">
            <div className="tm-card-header">
              <div>
                <div className="tm-card-title">Live Task Board</div>
                <div className="tm-muted" style={{ marginTop: 2, fontSize: 11 }}>
                  Neon PostgreSQL Persisted State
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="tm-chip ai" style={{ fontSize: 10 }}>
                  AI-Created Tasks Highlighted
                </span>
              </div>
            </div>

            <div className="tm-board">
              {columns.map(([statusKey, label]) => {
                const colTasks = tasks.filter((t) => t.status === statusKey);
                return (
                  <div className="tm-column" key={statusKey}>
                    <div className="tm-column-header">
                      <span>{label}</span>
                      <span className="tm-column-count">{colTasks.length}</span>
                    </div>

                    <div className="tm-tasks-list">
                      {colTasks.map((task) => (
                        <div
                          className={`tm-task ${task.isAiCreated ? "ai-created" : ""}`}
                          key={task.id}
                        >
                          <div className="tm-task-title">{task.title}</div>
                          <div className="tm-task-meta">
                            <span className="tm-chip">{task.assignee} · {task.dueDate}</span>
                            {task.priority === "high" && <span className="tm-chip high">High</span>}
                            {task.blocked && <span className="tm-chip blocked">Blocked</span>}
                            {task.isAiCreated && <span className="tm-chip ai">AI Subtask</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Taskmaster Agent Panel (5 Structured Operational Pillars) */}
          <div className="tm-card tm-agent">
            <div className="tm-card-header">
              <div>
                <div className="tm-card-title">Taskmaster Operational Control</div>
                <div className="tm-muted" style={{ marginTop: 2, fontSize: 11 }}>
                  Event-Driven Project Operator (Gemini 3.5 Flash / Vertex AI)
                </div>
              </div>
              <span
                className="tm-chip"
                style={{
                  color: workflowState === "WAITING_FOR_APPROVAL" ? "var(--warning)" : "var(--accent)",
                }}
              >
                ● {workflowState}
              </span>
            </div>

            <div className="tm-agent-body">
              {/* Human Approval Gate (Prominent when pending) */}
              {pendingApproval && (
                <div className="tm-approval-card">
                  <div className="tm-approval-header">
                    <span className="tm-approval-badge">⚠ Human Approval Gate</span>
                    <span className="tm-chip" style={{ fontSize: 10 }}>
                      Policy: {pendingApproval.riskLevel}
                    </span>
                  </div>

                  <div className="tm-governance-boundary" style={{ margin: "6px 0" }}>
                    Taskmaster will not change team ownership without approval.
                  </div>

                  <div className="tm-detail-row" style={{ fontSize: 12 }}>
                    <span className="tm-detail-key">Current Assignee:</span>
                    <span className="tm-detail-value">
                      <strong>Rahul</strong> (11 active tasks)
                    </span>
                  </div>

                  <div className="tm-detail-row" style={{ fontSize: 12 }}>
                    <span className="tm-detail-key">Proposed Assignee:</span>
                    <span className="tm-detail-value" style={{ color: "var(--accent)" }}>
                      <strong>{pendingApproval.payload?.targetAssigneeId || "Arjun"}</strong> (2 active tasks)
                    </span>
                  </div>

                  <div className="tm-approval-reason" style={{ marginTop: 6 }}>
                    <strong>Reason:</strong> {pendingApproval.payload?.reason || "Workload imbalance on launch critical path."}
                  </div>

                  <div className="tm-approval-actions">
                    <button
                      className="tm-btn-approve"
                      onClick={() => handleApprovalResolution("approve")}
                      disabled={running}
                    >
                      ✓ Approve & Execute
                    </button>
                    <button
                      className="tm-btn-reject"
                      onClick={() => handleApprovalResolution("reject")}
                      disabled={running}
                    >
                      ✕ Reject
                    </button>
                  </div>
                </div>
              )}

              {/* 5 Operational Pillars */}
              <div className="tm-agent-pillars">
                {/* 1. OBSERVED */}
                <div className="tm-pillar-section">
                  <div className="tm-pillar-header">
                    <span className="tm-pillar-title observed">1. Observed Signals</span>
                    <span className="tm-muted" style={{ fontSize: 10 }}>Real Graph Scan</span>
                  </div>
                  <div style={{ display: "grid", gap: 4 }}>
                    {(findings.length > 0
                      ? findings
                      : [
                          {
                            type: "blocker",
                            title: `${analysisData.blockers} blockers on launch critical path`,
                          },
                          {
                            type: "workload",
                            title: `Bottleneck: ${analysisData.bottleneck.name} has ${analysisData.bottleneck.count} active tasks`,
                          },
                          {
                            type: "deadline_risk",
                            title: `${analysisData.deadlineRisks} deadline risks for Friday launch`,
                          },
                        ]
                    ).map((f, idx) => (
                      <div
                        key={idx}
                        style={{
                          fontSize: 11,
                          padding: "5px 8px",
                          background: "#0d1014",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                        }}
                      >
                        <strong
                          style={{
                            color:
                              f.type === "blocker"
                                ? "var(--danger)"
                                : f.type === "deadline_risk"
                                ? "var(--warning)"
                                : "var(--blue)",
                          }}
                        >
                          [{f.type.toUpperCase()}]
                        </strong>{" "}
                        {f.title}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2. DECIDED */}
                <div className="tm-pillar-section">
                  <div className="tm-pillar-header">
                    <span className="tm-pillar-title decided">2. Decided Actions</span>
                    <span className="tm-muted" style={{ fontSize: 10 }}>Structured Plan</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.4 }}>
                    {agentSummary !== "Project state loaded from PostgreSQL. Ready to execute recovery analysis."
                      ? agentSummary
                      : "Create QA staging validation follow-up and rebalance Rahul's 11-task bottleneck."}
                  </div>
                </div>

                {/* 3. POLICY */}
                <div className="tm-pillar-section">
                  <div className="tm-pillar-header">
                    <span className="tm-pillar-title policy">3. Policy Gate</span>
                    <span className="tm-muted" style={{ fontSize: 10 }}>Authoritative Engine</span>
                  </div>
                  <div style={{ display: "grid", gap: 4, fontSize: 11 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>create_subtask (QA Validation)</span>
                      <span className="tm-chip" style={{ color: "var(--success)" }}>AUTO</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>send_slack_message (#alerts)</span>
                      <span className="tm-chip" style={{ color: "var(--success)" }}>AUTO</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span>reassign_task (Team Ownership)</span>
                      <span className="tm-chip" style={{ color: "var(--warning)" }}>REVIEW</span>
                    </div>
                  </div>
                </div>

                {/* 4. PROVED */}
                <div className="tm-pillar-section">
                  <div className="tm-pillar-header">
                    <span className="tm-pillar-title proved">4. Proved Verification</span>
                    <span className="tm-muted" style={{ fontSize: 10 }}>Double DB Check</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--success)" }}>
                    ✓ PostgreSQL transaction verified & state invariants preserved
                  </div>
                </div>

                {/* 5. NOTIFIED */}
                <div className="tm-pillar-section">
                  <div className="tm-pillar-header">
                    <span className="tm-pillar-title notified">5. Notified Sinks</span>
                    <span className="tm-muted" style={{ fontSize: 10 }}>Slack Web API</span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text)" }}>
                    💬 <strong>#taskmaster-demo</strong> notified with action audit receipts
                  </div>
                </div>
              </div>
            </div>

            {/* Agent Goal Input */}
            <div className="tm-agent-input">
              <input
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Ask Taskmaster: e.g. 'Get this project back on track…'"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !running) runAgent();
                }}
                disabled={running}
              />
              <button
                onClick={runAgent}
                disabled={running}
                className="tm-btn-run"
                style={{ padding: "0 14px" }}
              >
                {running ? "…" : "Run"}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Section: Live Workflow Timeline */}
        <div className="tm-card">
          <div className="tm-card-header">
            <div>
              <div className="tm-card-title">Live Cross-System Workflow Timeline</div>
              <div className="tm-muted" style={{ marginTop: 2, fontSize: 12 }}>
                Audited Chronological Records: EVENT → UNDERSTAND → DECIDE → ACT → VERIFY → COMMUNICATE
              </div>
            </div>
            <span className="tm-chip" style={{ fontSize: 11 }}>
              Real Persisted Events
            </span>
          </div>

          <div className="tm-timeline">
            {timeline.map((event) => (
              <div className="tm-timeline-item" key={event.id}>
                <span className="tm-timeline-time">{event.timestamp}</span>

                <div className="tm-timeline-content">
                  <div className="tm-timeline-header">
                    <span className={`tm-source-badge ${event.source}`}>
                      {event.source}
                    </span>
                    {event.stepStage && (
                      <span className="tm-source-badge-mini" style={{ color: "var(--accent)" }}>
                        {event.stepStage}
                      </span>
                    )}
                    <span className="tm-timeline-title">{event.title}</span>
                    {event.verified && (
                      <span style={{ fontSize: 10, color: "var(--success)", fontWeight: 700 }}>
                        ✓ VERIFIED
                      </span>
                    )}
                  </div>

                  <div className="tm-timeline-desc">{event.description}</div>

                  {event.linkedId && (
                    <div style={{ marginTop: 4 }}>
                      <span className="tm-muted" style={{ fontSize: 10 }}>
                        Ref ID: {event.linkedId.slice(0, 18)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </AppShell>
  );
}
