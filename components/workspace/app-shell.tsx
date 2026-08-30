"use client";

import { useState } from "react";
import { Sidebar } from "@/components/workspace/sidebar";
import { ExamHeader } from "@/components/workspace/exam-header";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <div className="hidden h-full shrink-0 pt-2 pl-2 pb-2 lg:flex">
        <Sidebar />
      </div>

      <main className="mx-2 flex min-w-0 flex-1 flex-col gap-1">
        <ExamHeader onMenuToggle={() => setMobileOpen(true)} />
        <div className="mb-2 min-h-0 flex-1 overflow-hidden">{children}</div>
      </main>

      <div
        className={`fixed inset-0 z-30 bg-black/40 transition-opacity duration-200 lg:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      <div
        className={`fixed right-0 top-0 z-40 h-full w-auto max-w-[85vw] transition-transform duration-200 lg:hidden ${
          mobileOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <Sidebar
          onNavigate={() => setMobileOpen(false)}
          initialCollapsed={false}
          forceExpanded
        />
      </div>
    </>
  );
}