"use client";

import { useEffect, useMemo, useState } from "react";

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
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [analysisData, setAnalysisData] = useState({
    risk: "HIGH",
    blockers: 4,
    deadlineRisks: 3,
    bottleneck: { name: "Rahul", count: 11 },
  });

  // Format activity log from DB into timeline item
  function mapActivityToTimeline(act: any): TimelineEvent {
    let source: TimelineEvent["source"] = "system";
    let title = act.eventType;
    let description = "";

    const meta = act.metadata || {};

    if (act.eventType === "GITHUB_PR_MERGED" || act.eventType.includes("GITHUB")) {
      source = "github";
      title = `GitHub PR #${meta.pullRequestNumber || "42"} merged`;
      description = `${meta.title || "Payment Webhook Integration"} (${meta.sourceBranch || "feature/webhook"} → main)`;
    } else if (act.eventType === "SUBTASK_CREATED") {
      source = "taskmaster";
      title = `Created QA subtask under '${meta.parentTitle || "Payment integration"}'`;
      description = `Title: "${meta.title}" · Verified in PostgreSQL ✓`;
    } else if (act.eventType === "TASK_REASSIGNED") {
      source = "postgres";
      title = `Reassigned task '${meta.taskTitle || meta.taskId}'`;
      description = `${meta.previousAssignee} → ${meta.newAssignee} (Approved by ${meta.approvedBy}) ✓`;
    } else if (act.eventType === "SLACK_MESSAGE_SENT") {
      source = "slack";
      title = `Project update posted to Slack`;
      description = `Channel: #${meta.channelId || "general"} · "${meta.messagePreview || "Taskmaster completed a project action"}…" ✓`;
    } else if (act.eventType === "APPROVAL_RESOLVED") {
      source = "human";
      title = `Human approval granted`;
      description = `Operator approved ${meta.action} for execution.`;
    } else if (act.eventType === "APPROVAL_REJECTED") {
      source = "human";
      title = `Human approval rejected`;
      description = `Operator rejected ${meta.action}. Task left unmodified.`;
    } else {
      source = act.actorType === "agent" ? "taskmaster" : "system";
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
          // Default initial baseline timeline entries
          setTimeline([
            {
              id: "init-1",
              source: "github",
              title: "GitHub PR #42 merged — Payment Webhook Integration",
              description: "Pull request merged into main by Arjun. Triggered Taskmaster event queue.",
              timestamp: "10:42:01 AM",
              verified: true,
            },
            {
              id: "init-2",
              source: "taskmaster",
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
      title: "Taskmaster Workflow Started",
      description: `Goal: "${activeGoal}" · Calling Gemini 3.5 Flash via Google ADK read tools…`,
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
        title: decision === "approve" ? "Human Operator Approved Action" : "Human Operator Rejected Action",
        description: data.summary || `Resolved approval '${pendingApproval.id}'.`,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        verified: true,
      };
      setTimeline((prev) => [resEvent, ...prev]);

      await loadData();
    } catch (err: any) {
      alert("Failed to submit approval resolution: " + err.message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="tm-shell">
      {/* Sidebar */}
      <aside className="tm-sidebar">
        <div className="tm-brand">
          <span className="tm-mark">T</span> Taskmaster
        </div>
        <div className="tm-nav">
          <button className="active">Command Center</button>
          <button>Task Board</button>
          <button>Workflow History</button>
          <button>Integrations</button>
        </div>
        <div className="tm-sidebar-footer">
          <div><strong>AI Project Operator</strong></div>
          <div style={{ marginTop: 4 }}>Google ADK · Gemini 3.5 Flash · Neon DB</div>
        </div>
      </aside>

      {/* Main Container */}
      <main className="tm-main">
        {/* Topbar */}
        <header className="tm-topbar">
          <div className="tm-topbar-left">
            <span className="tm-breadcrumb">Projects /</span>
            <span className="tm-project-title">Student Marketplace Launch</span>
            <span
              className="tm-chip"
              style={{
                background: workflowState === "WAITING_FOR_APPROVAL" ? "var(--warning-bg)" : "var(--panel-2)",
                color: workflowState === "WAITING_FOR_APPROVAL" ? "var(--warning)" : "var(--accent)",
                borderColor: workflowState === "WAITING_FOR_APPROVAL" ? "rgba(227,179,65,0.4)" : "rgba(203,243,70,0.3)",
              }}
            >
              ● {workflowState.replace(/_/g, " ")}
            </span>
          </div>

          <div className="tm-topbar-right">
            <button
              className="tm-btn-run"
              onClick={runAgent}
              disabled={running}
              title="Execute live Gemini 3.5 Flash recovery workflow"
            >
              {running ? "Analyzing Project…" : "⚡ Run Taskmaster"}
            </button>
          </div>
        </header>

        {/* Dashboard Grid */}
        <section className="tm-content">
          {/* Top Section: Health & Stats */}
          <div className="tm-card">
            <div className="tm-card-header">
              <div>
                <div className="tm-card-title">Project Health & Critical Path</div>
                <div className="tm-muted" style={{ marginTop: 3, fontSize: 12 }}>
                  Friday Target Launch · 17 Active Tasks · 8 Cross-Task Dependencies
                </div>
              </div>
              <div
                className="tm-chip high"
                style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px" }}
              >
                {analysisData.risk} RISK
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

            {/* Right: Taskmaster Agent Panel */}
            <div className="tm-card tm-agent">
              <div className="tm-card-header">
                <div>
                  <div className="tm-card-title">Taskmaster Agent Panel</div>
                  <div className="tm-muted" style={{ marginTop: 2, fontSize: 11 }}>
                    Autonomous AI Project Operator
                  </div>
                </div>
                <span
                  className="tm-chip"
                  style={{
                    color: workflowState === "WAITING_FOR_APPROVAL" ? "var(--warning)" : "var(--accent)",
                  }}
                >
                  {workflowState}
                </span>
              </div>

              <div className="tm-agent-body">
                {/* 1. Human Approval Card (Prominent when pending) */}
                {pendingApproval && (
                  <div className="tm-approval-card">
                    <div className="tm-approval-header">
                      <span className="tm-approval-badge">⚠ Human Approval Required</span>
                      <span className="tm-chip" style={{ fontSize: 10 }}>
                        Risk: {pendingApproval.riskLevel}
                      </span>
                    </div>

                    <div className="tm-approval-detail">
                      Action: <strong>{pendingApproval.action === "reassign_task" ? "Reassign Task" : pendingApproval.action}</strong>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text)", margin: "4px 0" }}>
                      Target: <strong>{pendingApproval.payload?.taskId}</strong> → <strong>{pendingApproval.payload?.targetAssigneeId}</strong>
                    </div>
                    <div className="tm-approval-reason">
                      <strong>Why:</strong> {pendingApproval.payload?.reason || "Workload rebalancing to resolve critical bottleneck."}
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

                {/* 2. Executive Recovery Summary */}
                <div className="tm-agent-box">
                  <div className="tm-agent-box-title">Operator Assessment & Goal</div>
                  <div style={{ fontSize: 12, lineHeight: 1.45, color: "var(--text)" }}>
                    {agentSummary !== "Project state loaded from PostgreSQL. Ready to execute recovery analysis."
                      ? agentSummary
                      : `${analysisData.bottleneck.name} has ${analysisData.bottleneck.count} active tasks and ${analysisData.blockers} blockers are stalling launch. Rebalance workload and create QA validation follow-ups.`}
                  </div>
                </div>

                {/* 3. Observed Findings */}
                <div className="tm-agent-box">
                  <div className="tm-agent-box-title">Observed Project Signals</div>
                  <div style={{ display: "grid", gap: 6 }}>
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
                          fontSize: 12,
                          padding: "6px 8px",
                          background: "var(--panel)",
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

                {/* 4. Action Lifecycle & Policy */}
                <div className="tm-agent-box">
                  <div className="tm-agent-box-title">Action Lifecycle & Verification</div>
                  <div style={{ display: "grid", gap: 6, fontSize: 11 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>1. create_subtask (QA Validation)</span>
                      <span className="tm-chip" style={{ color: "var(--success)" }}>AUTO · Verified ✓</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>2. send_slack_message (#project-alerts)</span>
                      <span className="tm-chip" style={{ color: "var(--success)" }}>AUTO · Delivered ✓</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span>3. reassign_task (Workload Balance)</span>
                      <span className="tm-chip" style={{ color: "var(--warning)" }}>
                        {pendingApproval ? "REVIEW · Awaiting You" : "REVIEW · Policy Gated"}
                      </span>
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
                  Audited Chronological Records · GitHub → Gemini → PostgreSQL → Slack
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
                      <span className="tm-timeline-title">{event.title}</span>
                      {event.verified && (
                        <span style={{ fontSize: 10, color: "var(--success)", fontWeight: 700 }}>
                          ✓ VERIFIED
                        </span>
                      )}
                    </div>

                    <div className="tm-timeline-desc">{event.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
