import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Taskmaster — AI Project Operator",
  description: "An AI project operator that manages the work behind your task list.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
