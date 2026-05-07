"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Navigation } from "./navigation";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <main>{children}</main>;
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="border-b border-neutral-200 bg-white lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col px-4 py-5">
          <div className="px-2">
            <p className="text-sm font-semibold text-neutral-950">Inbound AI</p>
            <p className="mt-1 text-xs text-neutral-500">Voice operations</p>
          </div>
          <Navigation />
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
