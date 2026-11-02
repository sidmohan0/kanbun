# Analytics starter

Open **Analytics starter** in the sidebar. Every active workspace member can download the blank
Excel workbook and use its setup guide, without owner permissions or a Google connection in Kanbun.
The template is a static file; downloading it exports no workspace data.

## Import your source

Use a separate workbook you own. Kanbun overwrites its synced **Issues** and **Projects** tabs.
Keep your analytics and planning assumptions outside those owned tabs.

For Google Sheets:

1. Upload the downloaded `.xlsx` to your own Google Drive. Open it with Google Sheets, then save it
   as Google Sheets.
2. In Kanbun's Analytics starter guide, paste the URL of the synced spreadsheet you can access.
   Copy the Issues import formula. Clear the **Raw Issues** tab in your new workbook and paste the
   formula normally in **A1**, leaving the cell format **Automatic**. Repeat for **Raw Projects**.
   If Google asks for more rows, add rows to the Raw tab; summaries remain limited to 1,000 records.
3. Choose **Allow access** when Google prompts. `IMPORTRANGE` requires permission to the source;
   downloading the template does not authorize access. A member can ask their owner to share the
   synced spreadsheet. The formulas run in Google Sheets, not Kanbun or Excel.
4. Set **File → Settings → Time zone** to **GMT**. Leave the source spreadsheet's sharing unchanged
   unless you intend to change who can see that data. Sharing the analytics workbook can expose its
   copied/imported data to its readers.

For a CSV snapshot in Excel or Google Sheets, an owner downloads **issues CSV** and **projects CSV**
from **Settings → Integrations**. Members can ask their owner for those files. Replace each matching
Raw tab starting at A1, preserving the header order and ISO UTC timestamp text. In Google CSV import,
turn off automatic text-to-number/date/formula conversion. The starter normalizes numeric estimate
and cycle text; it preserves legitimate zeros. CSV refresh is manual.

Both modes use the existing public-team export. The workbook does not expand Kanbun's export
permissions. It has capacity for **1,000 source rows** and **30 planning entries**. Source overflow
shows a warning and suppresses summaries instead of silently undercounting. For larger analyses,
extend every bounded formula range and detail row together; extend the ranking range when adding
planning entries. Keep the original raw source intact while adjusting your own workbook.

## Issue metrics

Enter both date bounds on **Issue analytics**. The start is inclusive and the end is exclusive, in
UTC. Blank assignee/cycle/team filters include all source rows. Assignee filters match exported display
names literally; identical names are grouped because the export contains names, not user IDs.

Completed throughput and estimate totals use the **Completed** timestamp, not configurable status
names. Missing estimates are reported separately from numeric zero. Mean completion days uses
`Completed − Started`, excludes missing timestamps and invalid date order, and counts invalid pairs
separately. Archived records remain included when present in the public export. An empty source or
missing date window produces unavailable results, not a healthy zero.

The detail table shows the source identifiers, filters and parsed dates behind these metrics. Use
cycle filters for comparisons between exported cycle numbers. The same number may occur in different
teams; use the explicit Team name filter to scope cycle comparisons. Leaving Team blank intentionally
includes all teams. Filtering the detail table alone does not change summary formulas.
No initiatives, derived SLA, customer or revenue fields are invented. This starter advances row145
with these bounded examples. Label/work-type analyses, bug rates, Gantt charts and Created-to-Started
(time-to-start) examples remain separate follow-ups; they are not delivered by this workbook.

## Project prioritization

Type a project ID into **Project planning**. `VLOOKUP` retrieves its current name, priority, lead
and target date from Raw Projects. Missing/duplicate source IDs remain explicit. Raw-source refresh
or reorder does not move the assumptions away from the project ID you entered.

Enter your own **impact** from 1–10, **confidence** from 0–100%, and a positive **effort** estimate.
The score is `impact × confidence ÷ effort`; rank 1 has the highest score.
For example, impact 8, confidence 50% and effort 2 yield a score of 2. A zero confidence is a
real zero. Missing assumptions or zero/negative effort have no score. These are your planning
assumptions, not Kanbun fields, AI predictions or a universal priority policy. Sort the entire
planning table by rank if desired; keep each ID and its assumptions together.

## Validation and limits

The checked-in workbook is generated from reviewable source under `scripts/analytics-starter/`.
Its authoring proof binds the asset and generator hashes and records synthetic recalculation checks
using the bundled spreadsheet engine. Repository tests inspect the actual downloaded XLSX and compare
its source columns with the real export. Browser tests cover ordinary-member downloads and setup in
browser/desktop contexts without owner API or Sheets/Drive/OAuth requests.

Those checks do not establish a successful live Google authorization or native Excel/Google
recalculation of every imported workbook. `IMPORTRANGE` authorization remains a user action. Review
unexpected import errors in your chosen spreadsheet application before relying on analytics.
