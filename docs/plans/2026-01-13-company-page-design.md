# Company Page Design

## Overview
Full dedicated page for each company at `/#/company/{id}`. Two-column layout with company details on the left and contacts list on the right.

## Navigation
- URL: `/#/company/{id}` (hash-based routing)
- Entry points:
  - Contact page: Click company name in company card
  - People table: Click company name column
  - Pipeline cards: Click company name
- "Back" link returns to previous location
- Browser back button works naturally

## Layout

### Left Column (~40%)

**Header:**
- Company name (large)
- Website URL (clickable, opens in new tab)
- LinkedIn button if URL exists

**Screenshot:**
- Full-width screenshot image
- "Regenerate" button

**Details Card:**
- Industry, company size, headquarters, founded year

**Description Section:**
- Company description (full text)
- Mission statement (if available)

**Additional Info (collapsible):**
- Products/Services
- Target Customers
- Technologies (as tags)
- Pricing Model

### Right Column (~60%)

**Header:**
- "Contacts (N)" with count

**Contacts List:**
- Name, title, email, stage badge, relationship snippet
- Entire row clickable → navigates to `/#/contact/{id}`
- Sorted by stage (active first), then name

**Empty state:**
- "No contacts at this company" message

## Backend Changes

**New endpoints:**
- `GET /api/companies/{id}/full` — Company details with all enriched fields
- `GET /api/companies/{id}/contacts` — All contacts at this company

No new tables or migrations needed.
