import type { Store } from "@kanbun/sync";
import { sheetsExport } from "./sheets-export";

export type ExportType = "issues" | "projects";

/** Quoted text retains separators/newlines; formula-like text gets an inert leading tab. */
export function csvText(rows: (string | number)[][]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((value) => {
            if (typeof value === "number") {
              if (!Number.isFinite(value)) throw new Error("CSV numeric values must be finite");
              return String(value);
            }
            const beginning = value.replace(/^[\s\p{Cc}]*/u, "");
            const dangerous =
              /^[=+\-@＝＋－＠]/u.test(beginning) || ["\t", "\r", "\n"].some((prefix) => value.startsWith(prefix));
            const text = dangerous ? "\t" + value : value;
            return `"${text.replaceAll('"', '""')}"`;
          })
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}

export function workspaceCsv(store: Store, type: ExportType): Response {
  const title = type === "issues" ? "Issues" : "Projects";
  const data = sheetsExport(store, true).find((sheet) => sheet.title === title)!;
  return new Response(csvText(data.values), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kanbun-${type}.csv"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}
