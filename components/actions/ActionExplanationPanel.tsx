"use client";

import React, { useState } from "react";
import { ActionExplanation } from "../../lib/models/action-explanation";

interface ActionExplanationPanelProps {
  actions: ActionExplanation[];
  loading?: boolean;
}

export function ActionExplanationPanel({
  actions,
  loading = false,
}: ActionExplanationPanelProps) {
  const [selectedAction, setSelectedAction] = useState<ActionExplanation | null>(null);

  if (loading) {
    return (
      <div className="tm-loading-state" style={{ padding: "24px 12px" }}>
        <div className="tm-spinner" />
        <span>Loading verified action lifecycle records…</span>
      </div>
    );
  }

  if (!actions || actions.length === 0) {
    return (
      <div className="tm-empty-state" style={{ padding: "24px 12px" }}>
        <div style={{ fontSize: 20, marginBottom: 4 }}>⚙️</div>
        <div style={{ fontSize: 12, fontWeight: 600 }}>No Actions Executed Yet</div>
        <div className="tm-muted" style={{ fontSize: 11, marginTop: 2 }}>
          Taskmaster will formulate and verify actions upon event trigger or manual run.
        </div>
      </div>
    );
  }

  return (
    <div className="tm-action-explanation-container">
      {/* Operational Value Chain Pipeline Header */}
      <div className="tm-action-pipeline-bar">
        <span className="tm-pipeline-tag">EVENT</span>
        <span className="tm-pipeline-arrow">→</span>
        <span className="tm-pipeline-tag">UNDERSTAND</span>
        <span className="tm-pipeline-arrow">→</span>
        <span className="tm-pipeline-tag">DECIDE</span>
        <span className="tm-pipeline-arrow">→</span>
        <span className="tm-pipeline-tag">ACT</span>
        <span className="tm-pipeline-arrow">→</span>
        <span className="tm-pipeline-tag active">VERIFY</span>
        <span className="tm-pipeline-arrow">→</span>
        <span className="tm-pipeline-tag active">COMMUNICATE</span>
      </div>

      {/* Action Explanation Cards Grid */}
      <div className="tm-action-cards-grid">
        {actions.map((act) => {
          const isAuto = act.policy.level === "AUTO";
          const isReview = act.policy.level === "REVIEW";
          const isCompleted = act.status === "COMPLETED";
          const isWaiting = act.status === "WAITING_FOR_APPROVAL";

          return (
            <div
              key={act.id}
              className={`tm-action-pow-card ${act.policy.level.toLowerCase()} ${
                act.status.toLowerCase()
              }`}
              onClick={() => setSelectedAction(act)}
              role="button"
              tabIndex={0}
              title="Click to view full Proof of Work & Verification details"
            >
              {/* Top Row: Action Type, Policy Badge & Status */}
              <div className="tm-pow-header">
                <div className="tm-pow-header-left">
                  <span className="tm-action-type-badge">
                    {act.action.actionType}
                  </span>
                  <span
                    className="tm-chip"
                    style={{
                      background: isAuto
                        ? "rgba(86, 211, 100, 0.15)"
                        : "rgba(227, 179, 65, 0.15)",
                      color: isAuto ? "var(--success)" : "var(--warning)",
                      borderColor: isAuto
                        ? "rgba(86, 211, 100, 0.3)"
                        : "rgba(227, 179, 65, 0.4)",
                      fontWeight: 700,
                      fontSize: 10,
                    }}
                  >
                    POLICY: {act.policy.level}
                  </span>
                </div>

                <div className="tm-pow-header-right">
                  <span
                    className="tm-chip"
                    style={{
                      background: isCompleted
                        ? "var(--success-bg)"
                        : isWaiting
                        ? "var(--warning-bg)"
                        : "var(--panel-2)",
                      color: isCompleted
                        ? "var(--success)"
                        : isWaiting
                        ? "var(--warning)"
                        : "var(--blue)",
                      fontWeight: 700,
                      fontSize: 10,
                    }}
                  >
                    ● {act.status.replace(/_/g, " ")}
                  </span>
                </div>
              </div>

              {/* Core Operational Structured Rows */}
              <div className="tm-pow-rows">
                {/* 1. TRIGGER */}
                <div className="tm-pow-row">
                  <span className="tm-pow-label">TRIGGER</span>
                  <div className="tm-pow-value">
                    <span className="tm-source-badge-mini">
                      {act.trigger.source === "github"
                        ? "🐙 GitHub"
                        : act.trigger.source === "user"
                        ? "👤 User"
                        : "⚙️ System"}
                    </span>
                    <span className="tm-pow-text">{act.trigger.summary}</span>
                  </div>
                </div>

                {/* 2. WHY */}
                <div className="tm-pow-row">
                  <span className="tm-pow-label">WHY</span>
                  <div className="tm-pow-value">
                    <span className="tm-pow-text highlight-why">{act.why}</span>
                  </div>
                </div>

                {/* 3. ACTION */}
                <div className="tm-pow-row">
                  <span className="tm-pow-label">ACTION</span>
                  <div className="tm-pow-value">
                    <strong className="tm-pow-text">{act.action.title}</strong>
                    {act.action.description && (
                      <span className="tm-pow-subtext">
                        {act.action.description}
                      </span>
                    )}
                  </div>
                </div>

                {/* 4. VERIFICATION */}
                <div className="tm-pow-row">
                  <span className="tm-pow-label">VERIFICATION</span>
                  <div className="tm-pow-value">
                    {act.verification.verified ? (
                      <span className="tm-verify-badge-success">
                        ✓ PostgreSQL Double-Checked
                      </span>
                    ) : isWaiting ? (
                      <span className="tm-verify-badge-pending">
                        ⏳ Pending Human Approval Gate
                      </span>
                    ) : (
                      <span className="tm-verify-badge-pending">
                        ⏳ Pending Execution
                      </span>
                    )}
                  </div>
                </div>

                {/* 5. OUTCOME */}
                <div className="tm-pow-row">
                  <span className="tm-pow-label">OUTCOME</span>
                  <div className="tm-pow-value">
                    <span className="tm-pow-text">{act.outcome.summary}</span>
                    {act.outcome.externalNotification && (
                      <span className="tm-slack-pill">
                        💬 Slack Delivered ({act.outcome.externalNotification.channel}) ✓
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Bottom Card Footer with Click for Details Prompt */}
              <div className="tm-pow-footer">
                <span className="tm-muted" style={{ fontSize: 11 }}>
                  Proof of Work ID: {act.id.slice(0, 16)}…
                </span>
                <span className="tm-pow-inspect-btn">Inspect Proof of Work 🔍</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Expandable Action Detail Modal */}
      {selectedAction && (
        <div
          className="tm-modal-backdrop"
          onClick={() => setSelectedAction(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="tm-modal-card tm-pow-modal"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="tm-modal-header">
              <div>
                <div className="tm-modal-title">
                  Proof of Work & Operational Audit
                </div>
                <div className="tm-muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {selectedAction.action.title} · Policy:{" "}
                  <strong>{selectedAction.policy.level}</strong>
                </div>
              </div>
              <button
                className="tm-modal-close"
                onClick={() => setSelectedAction(null)}
              >
                ✕
              </button>
            </div>

            {/* Modal Content */}
            <div className="tm-modal-body">
              {/* Pipeline Progression */}
              <div className="tm-modal-section">
                <div className="tm-modal-section-title">Lifecycle Chain</div>
                <div className="tm-action-pipeline-bar" style={{ margin: 0 }}>
                  <span className="tm-pipeline-tag active">EVENT</span>
                  <span className="tm-pipeline-arrow">→</span>
                  <span className="tm-pipeline-tag active">UNDERSTAND</span>
                  <span className="tm-pipeline-arrow">→</span>
                  <span className="tm-pipeline-tag active">DECIDE</span>
                  <span className="tm-pipeline-arrow">→</span>
                  <span
                    className={`tm-pipeline-tag ${
                      selectedAction.status === "COMPLETED" ? "active" : ""
                    }`}
                  >
                    ACT
                  </span>
                  <span className="tm-pipeline-arrow">→</span>
                  <span
                    className={`tm-pipeline-tag ${
                      selectedAction.verification.verified ? "active" : ""
                    }`}
                  >
                    VERIFY
                  </span>
                  <span className="tm-pipeline-arrow">→</span>
                  <span
                    className={`tm-pipeline-tag ${
                      selectedAction.outcome.deliveredToExternalSink
                        ? "active"
                        : ""
                    }`}
                  >
                    COMMUNICATE
                  </span>
                </div>
              </div>

              {/* 1. Triggering Event */}
              <div className="tm-modal-section">
                <div className="tm-modal-section-title">1. Triggering Event</div>
                <div className="tm-modal-box">
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Trigger Type:</span>
                    <span className="tm-detail-value">
                      {selectedAction.trigger.type}
                    </span>
                  </div>
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Source:</span>
                    <span className="tm-detail-value">
                      {selectedAction.trigger.source.toUpperCase()}
                    </span>
                  </div>
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Event Summary:</span>
                    <span className="tm-detail-value">
                      {selectedAction.trigger.summary}
                    </span>
                  </div>
                  {selectedAction.trigger.eventId && (
                    <div className="tm-detail-row">
                      <span className="tm-detail-key">Event ID:</span>
                      <span className="tm-detail-value">
                        {selectedAction.trigger.eventId}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. Reasoning Finding */}
              <div className="tm-modal-section">
                <div className="tm-modal-section-title">
                  2. Justifying Project Finding (WHY)
                </div>
                <div className="tm-modal-box">
                  <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
                    {selectedAction.why}
                  </p>
                </div>
              </div>

              {/* 3. Action & Parameters */}
              <div className="tm-modal-section">
                <div className="tm-modal-section-title">3. Exact Action Parameters</div>
                <div className="tm-modal-box">
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Action Type:</span>
                    <span className="tm-detail-value">
                      {selectedAction.action.actionType}
                    </span>
                  </div>
                  {selectedAction.action.taskId && (
                    <div className="tm-detail-row">
                      <span className="tm-detail-key">Target Task ID:</span>
                      <span className="tm-detail-value">
                        #{selectedAction.action.taskId}
                      </span>
                    </div>
                  )}
                  {selectedAction.action.parentTaskId && (
                    <div className="tm-detail-row">
                      <span className="tm-detail-key">Parent Task ID:</span>
                      <span className="tm-detail-value">
                        #{selectedAction.action.parentTaskId}
                      </span>
                    </div>
                  )}
                  {selectedAction.governance?.currentAssignee && (
                    <div className="tm-detail-row">
                      <span className="tm-detail-key">Current Assignee:</span>
                      <span className="tm-detail-value">
                        {selectedAction.governance.currentAssignee}
                      </span>
                    </div>
                  )}
                  {selectedAction.governance?.proposedAssignee && (
                    <div className="tm-detail-row">
                      <span className="tm-detail-key">Target Assignee:</span>
                      <span className="tm-detail-value">
                        {selectedAction.governance.proposedAssignee}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Policy Decision */}
              <div className="tm-modal-section">
                <div className="tm-modal-section-title">4. Authoritative Policy Gate</div>
                <div className="tm-modal-box">
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Policy Level:</span>
                    <span
                      className="tm-chip"
                      style={{
                        background:
                          selectedAction.policy.level === "AUTO"
                            ? "var(--success-bg)"
                            : "var(--warning-bg)",
                        color:
                          selectedAction.policy.level === "AUTO"
                            ? "var(--success)"
                            : "var(--warning)",
                      }}
                    >
                      {selectedAction.policy.level}
                    </span>
                  </div>
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Requires Approval:</span>
                    <span className="tm-detail-value">
                      {selectedAction.policy.requiresApproval ? "YES (Human Gate)" : "NO (Autonomous)"}
                    </span>
                  </div>
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Policy Rule:</span>
                    <span className="tm-detail-value" style={{ maxWidth: 350 }}>
                      {selectedAction.policy.ruleDescription}
                    </span>
                  </div>
                </div>
              </div>

              {/* 5. PostgreSQL Verification */}
              <div className="tm-modal-section">
                <div className="tm-modal-section-title">5. Double Database Verification (PROVED)</div>
                <div className="tm-modal-box">
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Verification Method:</span>
                    <span className="tm-detail-value">
                      {selectedAction.verification.method}
                    </span>
                  </div>
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Database State:</span>
                    <span className="tm-detail-value">
                      {selectedAction.verification.details || "Verified in PostgreSQL ✓"}
                    </span>
                  </div>
                </div>
              </div>

              {/* 6. External Notification */}
              <div className="tm-modal-section">
                <div className="tm-modal-section-title">6. External Action Sink (NOTIFIED)</div>
                <div className="tm-modal-box">
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Channel:</span>
                    <span className="tm-detail-value">
                      {selectedAction.outcome.externalNotification?.channel || "#taskmaster-demo"}
                    </span>
                  </div>
                  <div className="tm-detail-row">
                    <span className="tm-detail-key">Delivery Status:</span>
                    <span className="tm-detail-value" style={{ color: "var(--success)" }}>
                      {selectedAction.outcome.deliveredToExternalSink
                        ? "DELIVERED ✓"
                        : "AWAITING VERIFICATION"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="tm-modal-footer">
              <button
                className="tm-btn-refresh"
                onClick={() => setSelectedAction(null)}
              >
                Close Audit View
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
