import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Kanbun // Orchestrator",
  description: "Agent portfolio management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
