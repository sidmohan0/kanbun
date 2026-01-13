# Batch Email Feature Design

## Overview
Allow users to select multiple contacts from the pipeline board and open email drafts for all of them at once in Microsoft Outlook.

## Selection UI

**Card checkboxes:**
- Each contact card on the kanban board has a small checkbox in the top-left corner
- Checkbox is always visible (subtle gray, prominent when checked)
- Checked cards get a light highlight to show selection

**Batch action button:**
- "Batch Email (N)" button appears in pipeline header when 1+ contacts selected
- Shows count of selected contacts
- "Clear" link to deselect all

## Batch Email Modal

**Layout:**
- Header: "Batch Email (N contacts)"
- Template selector dropdown (existing templates from `/api/templates`)
- List of selected contacts showing:
  - Name, company, title
  - Email address (or red "No email" warning)
  - Remove button (×) to drop from batch
- Template preview (subject + body) when template selected
- Footer: "Open N Drafts" button + Cancel

**No-email handling:**
- Contacts without email shown with red warning
- Excluded from draft count
- Can be removed from list

## Submit Flow

**On clicking "Open N Drafts":**
1. Show "Opening drafts..." state
2. For each contact with email:
   - Build `mailto:` URL with template variables replaced
   - Trigger `window.open(mailto)` with 300ms delay between each
3. After all drafts triggered:
   - API call: move selected contacts to "Contacted" stage
   - Close modal, refresh pipeline, clear selection

**Template variables:**
- `{{first_name}}`, `{{last_name}}`, `{{full_name}}`
- `{{email}}`
- `{{company}}`, `{{title}}`

Missing variables replaced with empty string.

## Technical Notes

- `mailto:` URLs opened via `window.open()` with delays to prevent browser blocking
- Outlook on Mac handles multiple mailto triggers by opening separate compose windows
- Stage update via existing `PUT /api/contacts/{id}/stage` endpoint (called per contact)
