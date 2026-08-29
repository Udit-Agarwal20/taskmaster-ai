"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Command Center", href: "/", icon: "⚡" },
  { label: "Task Board", href: "/tasks", icon: "📋" },
  { label: "Workflow History", href: "/workflows", icon: "📜" },
  { label: "Integrations", href: "/integrations", icon: "🔌" },
];

interface NavLinksProps {
  onNavigate?: () => void;
  className?: string;
}

export function NavLinks({ onNavigate, className }: NavLinksProps) {
  const pathname = usePathname();

  return (
    <nav className={`tm-nav ${className || ""}`} aria-label="Main Navigation">
      {NAV_ITEMS.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href as any}
            onClick={onNavigate}
            className={`tm-nav-link ${isActive ? "active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            <span className="tm-nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="tm-nav-text">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
