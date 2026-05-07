import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AppShell } from "./app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Inbound AI Voice Dashboard",
  description: "Operator dashboard for the inbound AI voice platform"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-neutral-100 text-neutral-950 antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
