"use client";

import React, { useEffect, useState } from "react";
import { AppShell } from "../../components/layout/AppShell";

interface IntegrationItem {
  id: string;
  name: string;
  icon: string;
  status: string;
  role: string;
  details: Record<string, string | string[]>;
  lastEvent: {
    type: string;
    timestamp: string;
    summary: string;
  } | null;
}

export default function IntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadIntegrations() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/status");
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();
      if (Array.isArray(data.integrations)) {
        setIntegrations(data.integrations);
      } else {
        setIntegrations([]);
      }
    } catch (err: any) {
      setError(err.message || "Failed to load integrations status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadIntegrations();
  }, []);

  return (
    <AppShell pageTitle="Integrations & Cloud Infrastructure">
      <div className="tm-content">
        {/* Intro Card */}
        <div className="tm-card">
          <div className="tm-card-header">
            <div>
              <div className="tm-card-title">Production Integrations & Event Bus</div>
              <div className="tm-muted" style={{ marginTop: 3, fontSize: 12 }}>
                Live connected services powering autonomous event ingestion, Gemini 3.5 Flash reasoning & action sinks
              </div>
            </div>
            <button
              className="tm-btn-refresh"
              onClick={loadIntegrations}
              disabled={loading}
              title="Refresh integration status"
            >
              {loading ? "Checking…" : "↻ Check Status"}
            </button>
          </div>

          <div style={{ padding: "20px" }}>
            <div className="tm-integrations-intro">
              Taskmaster is deeply integrated with enterprise developer tools and Google Cloud services.
              All inbound webhooks are cryptographically verified, queued in Google Cloud Pub/Sub with IAM OIDC authentication,
              analyzed by Gemini 3.5 Flash via Vertex AI, atomically committed to Neon PostgreSQL, and reported to Slack.
            </div>
          </div>
        </div>

        {/* Integration Cards Grid */}
        {loading ? (
          <div className="tm-card tm-loading-state" style={{ padding: "48px 20px" }}>
            <div className="tm-spinner" />
            <span>Checking live connection health across Google Cloud and developer tools…</span>
          </div>
        ) : error ? (
          <div className="tm-card tm-error-state">
            <div className="tm-error-title">Failed to load integrations</div>
            <div className="tm-error-msg">{error}</div>
            <button className="tm-btn-retry" onClick={loadIntegrations}>
              Retry
            </button>
          </div>
        ) : (
          <div className="tm-integrations-grid">
            {integrations.map((item) => (
              <div key={item.id} className="tm-card tm-integration-card">
                <div className="tm-card-header">
                  <div className="tm-integration-header-left">
                    <span className="tm-integration-icon">{item.icon}</span>
                    <div>
                      <div className="tm-integration-name">{item.name}</div>
                      <div className="tm-integration-role">{item.role}</div>
                    </div>
                  </div>
                  <span
                    className="tm-chip"
                    style={{
                      background: "var(--success-bg)",
                      color: "var(--success)",
                      borderColor: "rgba(86,211,100,0.3)",
                      fontWeight: 700,
                    }}
                  >
                    ● {item.status}
                  </span>
                </div>

                <div className="tm-integration-body">
                  {/* Configuration & Details */}
                  <div className="tm-integration-details">
                    {Object.entries(item.details).map(([k, v]) => (
                      <div key={k} className="tm-detail-row">
                        <span className="tm-detail-key">
                          {k.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())}:
                        </span>
                        <span className="tm-detail-value">
                          {Array.isArray(v) ? v.join(", ") : v}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Last Known Event */}
                  <div className="tm-integration-last-event">
                    <div className="tm-last-event-header">
                      <span>Last Activity / Event:</span>
                      {item.lastEvent?.timestamp && (
                        <span className="tm-muted" style={{ fontSize: 11 }}>
                          {new Date(item.lastEvent.timestamp).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="tm-last-event-summary">
                      {item.lastEvent?.summary || "System active and listening for events."}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
