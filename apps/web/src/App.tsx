import { useEffect, useState } from "react";
import { Mark } from "./brand/Mark";

/**
 * Phase-0 shell. The real app (TanStack Router, sync provider, issue views)
 * is still planned; this proves the tokens, fonts and theme toggle.
 */
export function App() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset["theme"];
    else document.documentElement.dataset["theme"] = theme;
  }, [theme]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "var(--sidebar-w) 1fr", height: "100%" }}>
      <aside
        style={{
          background: "var(--surface-sunken)",
          borderRight: "1px solid var(--border)",
          padding: "var(--space-3)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 8px",
            fontFamily: "var(--font-display)",
            fontWeight: 600,
            fontSize: 17,
          }}
        >
          <Mark size={20} /> kanbun
        </div>
        <nav
          style={{
            marginTop: "var(--space-4)",
            display: "grid",
            gap: 2,
            color: "var(--text-secondary)",
            fontSize: "var(--text-sm)",
          }}
        >
          {["Inbox", "My issues", "Views", "Projects", "Agents"].map((x) => (
            <div key={x} style={{ padding: "6px 8px", borderRadius: "var(--radius-md)" }}>
              {x}
            </div>
          ))}
        </nav>
      </aside>
      <main style={{ padding: "var(--space-8)", maxWidth: 760 }}>
        <h1 style={{ fontSize: "var(--text-display)", margin: "0 0 var(--space-2)" }}>
          The issue tracker where agents pick up the work.
        </h1>
        <p style={{ color: "var(--text-secondary)", margin: "0 0 var(--space-6)" }}>
          Phase 0: sync engine, schema, tokens. The local Worker is ready; issue views are next.
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          {(["light", "dark", "system"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTheme(t)}
              style={{
                font: "inherit",
                padding: "4px 10px",
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--border-strong)",
                background: theme === t ? "var(--accent)" : "var(--surface)",
                color: theme === t ? "var(--accent-text)" : "var(--text)",
                cursor: "pointer",
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "var(--space-8)", display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 8 }}>
          {[
            ["--bg", "bg"],
            ["--surface", "surface"],
            ["--text", "text"],
            ["--text-secondary", "secondary"],
            ["--accent", "accent"],
            ["--border-strong", "border"],
          ].map(([v, label]) => (
            <div key={v}>
              <div
                style={{
                  height: 40,
                  borderRadius: "var(--radius-md)",
                  background: `var(${v})`,
                  border: "1px solid var(--border)",
                }}
              />
              <div style={{ fontSize: "var(--text-xs)", color: "var(--text-tertiary)", marginTop: 4 }}>{label}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
