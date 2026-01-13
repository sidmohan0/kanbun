# Contact Page Design

## Overview
Full dedicated page for each contact at `/#/contact/{id}`, replacing the current modal approach. Two-column layout with contact details on the left and a unified activity timeline on the right.

## Navigation
- URL: `/#/contact/{id}` (hash-based routing)
- Clicking contact from Pipeline or Contacts table navigates to full page
- "Back" link returns to previous location
- Browser back button works naturally

## Layout

### Left Column (~35%)

**Contact Header:**
- Name (large), title, company name
- Email (clickable mailto), phone if available
- LinkedIn button if URL exists

**Quick Actions:**
- "Send Email" button with template selector
- "Log Outreach" dropdown (Email, LinkedIn, Call, Other)
- Stage selector dropdown

**Relationship Field:**
- Editable text input, auto-saves on blur

**Company Card (collapsible):**
- Company name + website link
- Screenshot thumbnail
- Industry, size, headquarters
- Description (truncated with "Show more")

### Right Column (~65%)

**Add Entry Bar:**
- Quick note input + "Add Note" button
- Reminder quick-add: date picker + note + "Add Reminder"

**Activity Timeline:**
Chronological feed (newest first) with all activity types:
- Notes (📝) — timestamp, content, delete button
- Outreach (✉️) — type, timestamp, optional note
- Reminders (⏰) — due date, note, completion checkbox
- Stage changes (📍) — from/to stages, timestamp (auto-logged)

Visual differentiation by type. Completed reminders muted. Overdue reminders highlighted.

## Backend Changes

**New tables:**
- `notes` (id, contact_id, content, created_at)
- `stage_changes` (id, contact_id, from_stage, to_stage, changed_at)

**New endpoints:**
- `GET /api/contacts/{id}/full` — contact with company data
- `GET /api/contacts/{id}/timeline` — merged activity feed
- `POST /api/contacts/{id}/notes` — add note
- `DELETE /api/notes/{id}` — delete note

**Modified endpoints:**
- `PUT /api/contacts/{id}/stage` — also logs to stage_changes

**Migration:**
- Existing notes field content → create initial note entry if not empty
