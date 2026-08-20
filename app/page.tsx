"use client";

import { useEffect, useMemo, useState } from "react";

const initialTasks = [
  { id: "1", title: "Finalize pricing approval", status: "todo", priority: "high", meta: "Alex · Today", blocked: true },
  { id: "2", title: "Payment integration", status: "doing", priority: "high", meta: "Rahul · Fri", blocked: true },
  { id: "3", title: "Landing page", status: "doing", priority: "high", meta: "Maya · Thu", blocked: false },
  { id: "4", title: "Analytics events", status: "review", priority: "medium", meta: "Rahul · Thu", blocked: false },
  { id: "5", title: "Launch QA", status: "todo", priority: "medium", meta: "Sara · Fri", blocked: true },
  { id: "6", title: "Production deployment", status: "done", priority: "medium", meta: "Arjun · Fri", blocked: false },
];

const columns = [
  ["todo", "Todo"],
  ["doing", "Doing"],
  ["review", "Review"],
  ["done", "Done"],
] as const;

export default function Home() {
  const [tasks, setTasks] = useState(initialTasks);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [approved, setApproved] = useState(false);
  const [events, setEvents] = useState<string[]>([
    "Project loaded · 17 tasks · 8 dependencies",
    "Risk engine: 4 blockers, 2 deadline risks",
  ]);

  useEffect(() => {
    async function loadProjectData() {
      try {
        const [tasksRes, analysisRes] = await Promise.all([
          fetch("/api/projects/student-marketplace/tasks"),
          fetch("/api/projects/student-marketplace/analysis"),
        ]);
        if (tasksRes.ok) {
          const dbTasks = await tasksRes.json();
          if (Array.isArray(dbTasks) && dbTasks.length > 0) {
            setTasks(
              dbTasks.map((t: any) => ({
                id: t.id,
                title: t.title,
                status: t.status,
                priority: t.priority,
                meta: `${t.assignee} · ${t.dueDate ?? "No deadline"}`,
                blocked: t.blocked,
              }))
            );
          }
        }
        if (analysisRes.ok) {
          const analysis = await analysisRes.json();
          setEvents([
            `Project loaded · ${analysis.dependencies?.length ? "17 tasks" : "Tasks loaded"} · ${analysis.dependencies?.length ?? 8} dependencies`,
            `Risk engine: ${analysis.blockers} blockers, ${analysis.deadlineRisks} deadline risks`,
          ]);
        }
      } catch {
        // Retain fallback state on network error
      }
    }
    loadProjectData();
  }, []);

  const risk = useMemo(() => {
    const blocked = tasks.filter((t) => t.blocked).length;
    return blocked >= 3 ? "HIGH" : blocked >= 1 ? "MEDIUM" : "LOW";
  }, [tasks]);

  async function runAgent() {
    setRunning(true);
    setEvents((e) => [...e, "Taskmaster is analyzing blockers, dependencies and workload…"]);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal: prompt || "Get this project back on track." }),
      });
      const data = await res.json();
      setEvents((e) => [...e, data.summary ?? "Agent completed a planning cycle."]);
    } catch {
      setEvents((e) => [...e, "Demo mode: agent service is not configured yet. Core workflow remains interactive."]);
    } finally {
      setRunning(false);
      setPrompt("");
    }
  }

  async function addTask() {
    const title = window.prompt("Task title");
    if (!title) return;
    try {
      const res = await fetch("/api/projects/student-marketplace/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const created = await res.json();
      if (res.ok) {
        setTasks((current) => [{ id: created.id, title: created.title, status: created.status, priority: created.priority, meta: `${created.assignee} · ${created.dueDate ?? "No deadline"}`, blocked: created.blocked }, ...current]);
        setEvents((e) => [...e, `Task created · ${title}`]);
      }
    } catch {
      setEvents((e) => [...e, "Could not create task."]);
    }
  }

  function approve() {
    setApproved(true);
    setEvents((e) => [...e, "Approval granted · workload change applied · verification passed."]);
    setTasks((current) => current.map((t) => t.id === "4" ? { ...t, meta: "Maya · Thu" } : t));
  }

  return (
    <div className="tm-shell">
      <aside className="tm-sidebar">
        <div className="tm-brand"><span className="tm-mark">T</span> Taskmaster</div>
        <div className="tm-nav">
          <button className="active">Command center</button>
          <button>Projects</button>
          <button>Approvals</button>
          <button>Activity</button>
        </div>
        <div style={{ marginTop: 28, padding: 10, fontSize: 11, color: "var(--muted)" }}>
          AI Project Operator
        </div>
      </aside>

      <main className="tm-main">
        <header className="tm-topbar">
          <div className="tm-topbar-left">
            <span className="tm-breadcrumb">Projects /</span>
            <span className="tm-project-title">Student Marketplace Launch</span>
          </div>
          <button className="tm-command">⌘ K&nbsp;&nbsp; Ask Taskmaster…</button>
        </header>

        <section className="tm-content">
          <div className="tm-grid">
            <div>
              <div className="tm-card" style={{ marginBottom: 18 }}>
                <div className="tm-card-header">
                  <div>
                    <div className="tm-card-title">Project health</div>
                    <div className="tm-muted" style={{ marginTop: 4, fontSize: 12 }}>Friday launch · 17 active tasks</div>
                  </div>
                  <div className="tm-risk"><strong>{risk} RISK</strong></div>
                </div>
                <div className="tm-health">
                  <div className="tm-stat"><div className="tm-stat-value">4</div><div className="tm-stat-label">Blockers</div></div>
                  <div className="tm-stat"><div className="tm-stat-value">2</div><div className="tm-stat-label">Deadline risks</div></div>
                  <div className="tm-stat"><div className="tm-stat-value">1</div><div className="tm-stat-label">Bottleneck</div></div>
                  <div className="tm-stat"><div className="tm-stat-value">42%</div><div className="tm-stat-label">Progress</div></div>
                </div>
              </div>

              <div className="tm-card">
                <div className="tm-card-header">
                  <div className="tm-card-title">Work board</div>
                  <button className="tm-btn secondary" onClick={addTask}>+ Task</button>
                </div>
                <div className="tm-board">
                  {columns.map(([status, label]) => (
                    <div className="tm-column" key={status}>
                      <div className="tm-column-header"><span>{label}</span><span>{tasks.filter((t) => t.status === status).length}</span></div>
                      {tasks.filter((t) => t.status === status).map((task) => (
                        <div className="tm-task" key={task.id}>
                          <div className="tm-task-title">{task.title}</div>
                          <div className="tm-task-meta">
                            <span className="tm-chip">{task.meta}</span>
                            {task.priority === "high" && <span className="tm-chip high">High</span>}
                            {task.blocked && <span className="tm-chip blocked">Blocked</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <section className="tm-card tm-agent">
              <div className="tm-card-header">
                <div>
                  <div className="tm-card-title">Taskmaster Agent</div>
                  <div className="tm-muted" style={{ marginTop: 4, fontSize: 11 }}>Autonomous project operator</div>
                </div>
                <span className="tm-chip" style={{ color: "var(--success)" }}>ONLINE</span>
              </div>

              <div className="tm-agent-body">
                <div className="tm-risk">
                  <strong>Suggested action</strong>
                  <div style={{ marginTop: 6, fontSize: 12 }}>Rahul has 11 active tasks. I recommend moving Analytics events to Maya and prioritizing pricing approval.</div>
                </div>

                {!approved && (
                  <div className="tm-approval">
                    <strong style={{ fontSize: 12 }}>Approval required</strong>
                    <div className="tm-muted" style={{ marginTop: 6, fontSize: 11 }}>1 reassignment · affects 1 teammate</div>
                    <div className="tm-approval-actions">
                      <button className="tm-btn" onClick={approve}>Approve</button>
                      <button className="tm-btn secondary" onClick={() => setApproved(true)}>Reject</button>
                    </div>
                  </div>
                )}

                {events.map((event, index) => (
                  <div className="tm-agent-event" key={`${event}-${index}`}>
                    <strong>{index === events.length - 1 && running ? "Working…" : "Agent activity"}</strong>
                    <span className="tm-muted">{event}</span>
                  </div>
                ))}
              </div>

              <div className="tm-agent-input">
                <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Get this project back on track…" onKeyDown={(e) => { if (e.key === "Enter") runAgent(); }} />
                <button onClick={runAgent} disabled={running}>{running ? "…" : "Run"}</button>
              </div>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}
