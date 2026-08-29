"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { NavLinks } from "../navigation/NavLinks";

interface AppShellProps {
  children: React.ReactNode;
  workflowState?: string;
  headerAction?: React.ReactNode;
  pageTitle?: string;
}

export function AppShell({
  children,
  workflowState = "ONLINE",
  headerAction,
  pageTitle,
}: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile drawer on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMobileMenuOpen(false);
      }
    }
    if (mobileMenuOpen) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  const isWaitingApproval = workflowState === "WAITING_FOR_APPROVAL";

  return (
    <div className="tm-shell">
      {/* Desktop Sidebar */}
      <aside className="tm-sidebar">
        <div className="tm-brand">
          <Link href="/" className="tm-brand-link">
            <span className="tm-mark">T</span>
            <span>Taskmaster</span>
          </Link>
        </div>

        <NavLinks />

        <div className="tm-sidebar-footer">
          <div>
            <strong>AI Project Operator</strong>
          </div>
          <div style={{ marginTop: 4 }}>Google ADK · Gemini 3.5 Flash · Neon DB</div>
        </div>
      </aside>

      {/* Mobile Drawer Backdrop */}
      {mobileMenuOpen && (
        <div
          className="tm-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div
          className="tm-mobile-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation Menu"
        >
          <div className="tm-drawer-header">
            <div className="tm-brand">
              <span className="tm-mark">T</span>
              <span>Taskmaster</span>
            </div>
            <button
              className="tm-drawer-close-btn"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
            >
              ✕
            </button>
          </div>

          <NavLinks onNavigate={() => setMobileMenuOpen(false)} />

          <div className="tm-sidebar-footer" style={{ marginTop: "auto" }}>
            <div>
              <strong>AI Project Operator</strong>
            </div>
            <div style={{ marginTop: 4 }}>Google ADK · Gemini 3.5 Flash · Neon DB</div>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main className="tm-main">
        {/* Topbar */}
        <header className="tm-topbar">
          <div className="tm-topbar-left">
            {/* Mobile Hamburger Toggle Button */}
            <button
              className="tm-menu-btn"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              title="Open Navigation Menu"
            >
              ☰
            </button>

            <span className="tm-breadcrumb">Projects /</span>
            <span className="tm-project-title">
              {pageTitle || "Student Marketplace Launch"}
            </span>

            <span
              className="tm-chip"
              style={{
                background: isWaitingApproval ? "var(--warning-bg)" : "var(--panel-2)",
                color: isWaitingApproval ? "var(--warning)" : "var(--accent)",
                borderColor: isWaitingApproval
                  ? "rgba(227,179,65,0.4)"
                  : "rgba(203,243,70,0.3)",
              }}
            >
              ● {workflowState.replace(/_/g, " ")}
            </span>
          </div>

          {headerAction && <div className="tm-topbar-right">{headerAction}</div>}
        </header>

        {/* Page Content */}
        {children}
      </main>
    </div>
  );
}
