# Personal Contacts Feature Design

## Overview

Add support for personal contacts (family, friends, acquaintances) alongside existing CRM contacts. Personal contacts have simplified fields, colorful visual treatment, and iMessage/email actions.

## Data Model

### Schema Changes

```sql
-- Add contact_type column
ALTER TABLE contacts ADD COLUMN contact_type TEXT DEFAULT 'crm';

-- contact_type values: 'crm' or 'personal'
-- relationship values for personal: 'family', 'friend', 'acquaintance'
-- company_id becomes truly optional (nullable) for personal contacts
-- Personal contacts use stage = 'personal' (new stage value)
```

### Existing contacts
- All existing contacts default to `contact_type = 'crm'`
- No data migration needed beyond adding the column

## UI Components

### 1. Add Contact Modal

**Triggered from:**
- "Add Contact" button in People tab header
- "Add Contact" quick action card on Home tab

**Form fields:**
- Contact Type toggle: CRM / Personal (default: Personal)
- First Name (required)
- Last Name
- Email
- Phone
- Relationship dropdown (Family/Friend/Acquaintance) - personal only
- Company dropdown/search - CRM only
- Title - CRM only
- LinkedIn URL (optional, both types)
- Notes textarea (optional initial note)

### 2. Pipeline (Kanban) View

**New "Personal" column:**
- Leftmost position (before Backlog)
- Shows all personal contacts
- Cards display: name, colored relationship badge, phone/email icons

**Personal contact cards:**
- Softer background with colored left border
- Quick action icons on hover: Email, iMessage
- Click opens detail page
- Not draggable to other columns

### 3. People Tab

**Filter dropdown:**
- Options: All Contacts, CRM Contacts, Personal Contacts
- Default: All Contacts
- Position: top of page near search

**Table changes:**
- Type column with badge (CRM/Personal)
- For personal contacts, Company column shows relationship instead

### 4. Personal Contact Detail Page

**Visual treatment by relationship:**
- Family: Rose/pink accent (#f43f5e)
- Friend: Blue accent (#3b82f6)
- Acquaintance: Sage/green accent (#84cc16)

**Header card:**
- Colored accent bar at top
- Name prominently displayed
- Relationship badge with matching color

**Contact info:**
- Email with mailto: link
- Phone with Call (tel:) and iMessage (sms:) buttons
- LinkedIn if provided

**Quick actions:**
- Send Email
- Send iMessage
- Add Note
- Set Reminder

**Timeline:**
- Notes and reminders only (no outreach log)
- Same chronological display as CRM contacts

**Hidden for personal:**
- Pipeline stage selector
- Outreach logging
- Company link

## API Changes

### New Endpoints

```
POST /api/contacts - Create new contact (CRM or personal)
```

### Modified Endpoints

```
GET /api/database/contacts - Add contact_type filter parameter
GET /api/pipeline - Include 'personal' stage in response
```

## Files to Modify

- `app/database.py` - schema migration
- `app/main.py` - new/modified endpoints
- `app/models.py` - updated Pydantic models
- `app/static/index.html` - all UI components
