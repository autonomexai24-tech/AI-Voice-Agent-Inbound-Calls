"use client";

import { usePathname } from "next/navigation";

const navItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "CRM", href: "/crm" },
  { label: "Calendar", href: "/calendar" },
  { label: "Agent Config", href: "/agent-config" },
  { label: "Business", href: "/business-settings" }
];

export function Navigation() {
  const pathname = usePathname();

  return (
    <nav className="mt-6 flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible" aria-label="Main navigation">
      {navItems.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <a
            key={item.label}
            href={item.href}
            className={[
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-neutral-950 text-white" : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950"
            ].join(" ")}
          >
            {item.label}
          </a>
        );
      })}
    </nav>
  );
}
