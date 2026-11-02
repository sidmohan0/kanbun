import { useState } from "react";
import { Button } from "./components/ui/button";

export function AnalyticsStarterSettings() {
  const [source, setSource] = useState("");
  const [message, setMessage] = useState("");
  let spreadsheet: string | null = null;
  try {
    const url = new URL(source);
    const id = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname)?.[1];
    if (url.protocol === "https:" && url.hostname === "docs.google.com" && !url.username && !url.password && id)
      spreadsheet = `https://docs.google.com/spreadsheets/d/${id}`;
  } catch {
    /* A blank or incomplete URL keeps import controls unavailable. */
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Import formula copied.");
    } catch {
      setMessage("Select the formula field and copy it with your keyboard.");
    }
  }
  return (
    <section className="github-settings" aria-label="Analytics starter">
      <h2>Analytics starter</h2>
      <p>
        Analyze completed issues by date, assignee, team and cycle, then prioritize projects using your own planning
        assumptions.
      </p>
      <p>
        <a href="/analytics/kanbun-analytics-starter.xlsx" download="kanbun-analytics-starter.xlsx">
          Download analytics workbook (.xlsx)
        </a>
      </p>
      <p>
        The blank workbook contains no workspace data. It supports up to 1,000 source rows and flags overflow. Missing
        data stays unavailable.
      </p>
      <details>
        <summary>Set up Google Sheets or CSV imports</summary>
        <h3>Google Sheets</h3>
        <ol>
          <li>
            Upload the downloaded workbook to your own Google Drive. Open it with Google Sheets and save it as Google
            Sheets.
          </li>
          <li>Use a separate workbook. Kanbun overwrites its owned Issues and Projects tabs during sync.</li>
          <li>
            Paste your synced spreadsheet URL below. Clear the matching Raw tab, then put its import formula in cell A1.
          </li>
          <li>
            Choose <strong>Allow access</strong> when Google prompts. You need permission to the source spreadsheet;
            this download does not grant access.
          </li>
          <li>
            Set File → Settings → Time zone to GMT. Set both date bounds on Issue analytics; the end date is exclusive.
          </li>
        </ol>
        <label>
          Synced spreadsheet URL
          <input
            type="url"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setMessage("");
            }}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit"
          />
        </label>
        {source && !spreadsheet && <p role="status">Enter a Google Sheets spreadsheet URL.</p>}
        {spreadsheet &&
          (["Issues", "Projects"] as const).map((type) => {
            const value = `=IMPORTRANGE("${spreadsheet}","${type}!A1:${type === "Issues" ? "AA" : "R"}")`;
            return (
              <div key={type}>
                <label>
                  {type} import formula
                  <input readOnly value={value} onFocus={(event) => event.target.select()} />
                </label>
                <Button variant="outline" onClick={() => void copy(value)}>
                  Copy {type.toLowerCase()} formula
                </Button>
              </div>
            );
          })}
        {message && <p role="status">{message}</p>}
        <p>
          IMPORTRANGE runs in Google Sheets after authorization. It does not run in Excel or in Kanbun. Review sharing:
          anyone you share the analytics workbook with may see imported data.
        </p>
        <h3>CSV or Excel</h3>
        <p>
          Workspace owners can download issues and projects CSVs from Settings → Integrations. Members can ask their
          owner for those files or access to the synced Google spreadsheet. Import each file into its matching Raw
          Issues or Raw Projects tab at A1, replacing old contents and preserving headers and UTC timestamp text. In
          Google CSV import, turn off automatic text-to-number/date/formula conversion; the starter converts numeric
          estimate and cycle text for calculations.
        </p>
        <p>
          Enter project IDs in Project planning. Impact, confidence and effort are your inputs; the score is impact ×
          confidence ÷ effort. Zero or missing effort is unavailable. Planning inputs stay attached to the IDs you enter
          when raw data refreshes. Identical assignee display names are grouped together.
        </p>
      </details>
    </section>
  );
}
