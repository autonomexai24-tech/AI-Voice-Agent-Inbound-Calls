"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Navigation } from "./navigation";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/login") {
    return <main>{children}</main>;
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b border-neutral-200 bg-white lg:min-h-screen lg:border-b-0 lg:border-r">
        <div className="flex h-full flex-col px-4 py-5">
          <div className="rounded-2xl border border-neutral-200 bg-neutral-950 p-4 text-white">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-sm font-bold text-neutral-950">
                AI
              </div>
              <div>
                <p className="text-sm font-semibold">Inbound AI</p>
                <p className="mt-1 text-xs text-neutral-400">Voice operations</p>
              </div>
            </div>
          </div>
          <Navigation />
          <div className="mt-auto hidden space-y-3 lg:block">
            <button
              type="button"
              onClick={handleLogout}
              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-left text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100"
            >
              Sign out
            </button>
            <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-xs leading-5 text-neutral-500">
              Production console for calls, bookings, transcripts, language settings, and runtime health.
            </div>
          </div>
        </div>
      </aside>
      <main>{children}</main>
    </div>
  );
}
