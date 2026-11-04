# CSV issue import

Workspace owners can import a CSV file from Settings → Integrations → CSV exports. The file is parsed locally in the
browser; Kanbun does not upload or retain the original file. After selecting a destination team, Kanbun proposes column
mappings from familiar headers. Review or change the mappings and the row preview before choosing which valid rows to
create. Imported issues go through the regular `issueCreate` mutation, so team access, status, assignee, and label rules
are enforced, and Kanbun assigns the issue number and identifier.

The import accepts UTF-8 CSV files up to 2 MB and 1,000 data rows. Quoted commas, escaped quotes, and quoted line
breaks are supported. Each row must have the same number of cells as the header. Formula-like cells are treated as
plain text; no cell content is evaluated.

The supported issue fields are title (required), description, status, priority, estimate, due date, assignee, and
labels. Status names must resolve uniquely in the selected team's active workflow. Priority accepts `0`–`4`, `none`,
`urgent`, `high`, `medium`, or `low`. Due dates use `YYYY-MM-DD`. Assignees and labels must resolve uniquely to active
workspace records available to the selected team. Unrecognized values are called out in the preview; rows with errors
are skipped. Blank optional values use Kanbun's normal defaults.

An `ID`, `Identifier`, or `Issue ID` column can be mapped as a source identifier. If that identifier matches an
existing issue identifier in the selected team, or repeats earlier in this file, that row is skipped as a duplicate.
Kanbun does not preserve external IDs as issue IDs and does not deduplicate by title.

Unmapped columns are listed and ignored. The current importer does not map project, cycle, milestone, parent/related
issue, comment, attachment, or lifecycle timestamp fields. Import those relationships separately after creating the
issues. The mapping proposal is deterministic header matching; it does not use an AI model or infer semantics from
sample values.
