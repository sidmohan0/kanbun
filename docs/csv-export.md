# One-time CSV exports

The workspace owner can open **Settings → Integrations → CSV exports** and download public-team
issues or projects. This works in browser, desktop, and local owner sessions without a Google
account, connection, or OAuth setup. Members cannot export. The download reflects the current main
workspace, not an offline browser cache or an unmerged workspace branch.

CSV and Google Sheets share the same privacy filter and currently modeled columns. Private-team
issues, private-only projects, and private relationship names are excluded. Archived public records
remain included according to that shared filter; trashed objects and retired teams do not export.
Initiatives and unsupported model fields remain outside this export.

Files use UTF-8 with a byte-order mark, comma separators, CRLF records, quoted string fields and
doubled embedded quotes. Numeric values stay numeric. For spreadsheet safety, strings beginning
with formula operators (including full-width variants and operators after whitespace), tabs or
line breaks receive a leading tab inside their quoted field. This follows the
[OWASP guidance on CSV injection](https://owasp.org/www-community/attacks/CSV_Injection) for Excel-facing
exports. The added tab is part of the downloaded data and may matter to programmatic consumers;
there is no universal guarantee for every spreadsheet program or later re-saving/editing.

The authenticated endpoint is `GET /api/exports.csv?type=issues` or `type=projects`. Downloads are
marked as attachments and must not be cached. Local requests use the same explicit local actor
selection as other workspace routes; hosted requests recheck the current native owner authority.
