# Company Page Enhancements & Delete Functionality

## Overview

Enhance the existing company page with an activity timeline, editable fields, and keywords display. Add delete functionality to both contact and company pages.

## API Changes

### New Endpoints

```
DELETE /api/contacts/{id}                    - Delete a contact
DELETE /api/companies/{id}                   - Delete a company (orphans contacts)
PUT    /api/companies/{id}                   - Update company fields
GET    /api/companies/{id}/timeline          - Get company activity timeline
POST   /api/companies/{id}/activity          - Log company activity
GET    /api/companies/{id}/keywords          - Get company keywords
POST   /api/companies/{id}/keywords          - Add keyword
DELETE /api/companies/{id}/keywords/{keyword} - Remove keyword
```

## Database Changes

New table for company activity tracking:

```sql
CREATE TABLE IF NOT EXISTS company_activities (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    description TEXT,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
)
```

Activity types:
- `note` - Manual note added
- `field_update` - Company field edited (stores old/new value)
- `keyword_added` - Keyword added
- `keyword_removed` - Keyword removed
- `contact_added` - New contact linked to company
- `contact_removed` - Contact unlinked/deleted

## Delete Behavior

### Deleting a Contact
- Removes contact record
- Cascades to: contact_notes, reminders, outreach_log entries
- Confirmation: "Delete [Name]? This will remove all their notes, reminders, and activity history."

### Deleting a Company
- Sets `company_id = NULL` on all linked contacts (orphans them)
- Deletes: company_notes, company_activities, keywords for this company
- Deletes screenshot file if exists
- Deletes company record
- Confirmation: "Delete [Company Name]? Associated contacts will be kept but unlinked from this company."

## UI Changes

### Company Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│  ← Back                                        [Delete]     │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  Company Name (editable)                  │
│  │  Screenshot  │  Website | LinkedIn                       │
│  └──────────────┘  Industry | Location (editable)           │
├─────────────────────────────────────────────────────────────┤
│  Description (editable textarea)                            │
├─────────────────────────────────────────────────────────────┤
│  Keywords                                    [+ Add]        │
│  [SaaS] [API] [B2B ×]  (× to remove)                       │
├─────────────────────────────────────────────────────────────┤
│  ▼ Additional Details (collapsible)                         │
├───────────────────────────┬─────────────────────────────────┤
│  Activity Timeline        │  Contacts                       │
│  [+ Add note...]          │  - Contact list                 │
│  - Chronological entries  │                                 │
└───────────────────────────┴─────────────────────────────────┘
```

### Editable Fields
- Company name, industry, location, headquarters
- Description (textarea)
- Mission statement, products/services, target customers, pricing model

Changes auto-save on blur and log to activity timeline.

### Delete Buttons
- Contact page: Red delete icon in top-right header
- Company page: Red delete icon in top-right header
- People table: Trash icon on row hover
- Database table: Trash icon on row hover

## Implementation Phases

### Phase 1 - Backend
1. Add `company_activities` table
2. DELETE /api/contacts/{id}
3. DELETE /api/companies/{id}
4. PUT /api/companies/{id}
5. Company timeline endpoints
6. Company keywords endpoints

### Phase 2 - Delete UI
1. Delete button on contact page
2. Delete button on company page
3. Hover delete on People table rows
4. Hover delete on Database table rows
5. Confirmation dialogs

### Phase 3 - Company Page Enhancements
1. Inline editable fields
2. Keywords section with add/remove
3. Activity timeline (replacing simple notes)
4. Auto-log field changes
