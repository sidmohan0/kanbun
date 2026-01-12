# Email Templates Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add saveable, reusable email templates with variable substitution and category organization.

**Architecture:** Store templates in SQLite, dropdown selector in contact modal, management UI on Home tab.

**Tech Stack:** FastAPI, SQLite/aiosqlite, vanilla JavaScript

---

## Database Schema

**`email_templates` table:**
```sql
CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Supported variables** (use `{{variable}}` syntax):
- Contact: `{{first_name}}`, `{{last_name}}`, `{{title}}`, `{{email}}`
- Company: `{{company_name}}`, `{{company_website}}`, `{{company_description}}`
- Keywords: `{{core_product}}`, `{{industry}}`, `{{pain_points}}`

---

## Task 1: Database Schema Update

**Files:**
- Modify: `app/database.py`

**Changes:**
1. Add `email_templates` table to SCHEMA
2. Add migration for existing databases
3. Seed default template on init

**Default template:**
- Name: "Quick Introduction"
- Category: "Cold Outreach"
- Subject: "Quick question for {{first_name}}"
- Body:
```
Hi {{first_name}},

I came across {{company_name}} and wanted to reach out.

[Your message here]

Best,
[Your name]
```

---

## Task 2: API Endpoints

**Files:**
- Modify: `app/main.py`

**Endpoints:**
- `GET /api/templates` - List all templates grouped by category
- `POST /api/templates` - Create template {name, category, subject, body}
- `PUT /api/templates/{id}` - Update template
- `DELETE /api/templates/{id}` - Delete template
- `GET /api/templates/categories` - List unique categories

---

## Task 3: Contact Modal - Template Dropdown

**Files:**
- Modify: `app/static/index.html`

**Changes:**
1. Add template dropdown above Email button in contact modal
2. Group templates by category using `<optgroup>`
3. Show subject preview below dropdown when template selected
4. Update `emailContact()` to use selected template
5. Replace `{{variables}}` with contact/company data

**Variable replacement function:**
```javascript
function renderTemplate(template, contact) {
    let subject = template.subject;
    let body = template.body;

    const vars = {
        'first_name': contact.first_name || '',
        'last_name': contact.last_name || '',
        'title': contact.title || '',
        'email': contact.email || '',
        'company_name': contact.company_name || '',
        'company_website': contact.company_website || '',
        'company_description': contact.company_description || '',
        'core_product': contact.core_product || '',
        'industry': contact.industry || '',
        'pain_points': contact.pain_points || ''
    };

    for (const [key, value] of Object.entries(vars)) {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        subject = subject.replace(regex, value);
        body = body.replace(regex, value);
    }

    return { subject, body };
}
```

---

## Task 4: Home Tab - Template Manager Section

**Files:**
- Modify: `app/static/index.html`

**Changes:**
1. Add "Email Templates" section to Home tab
2. List templates grouped by category (collapsible)
3. Each template row has Edit and Delete buttons
4. "+ New" button to create template

---

## Task 5: Template Editor Modal

**Files:**
- Modify: `app/static/index.html`

**Changes:**
1. Create template editor modal with fields:
   - Name (text input)
   - Category (dropdown with option to add new)
   - Subject (text input with variable hints)
   - Body (textarea with variable hints)
2. Preview button shows rendered example
3. Save calls POST/PUT endpoint
4. Cancel closes modal

**Variable hints displayed:**
```
Available: {{first_name}}, {{last_name}}, {{company_name}}, {{title}},
{{company_description}}, {{core_product}}, {{industry}}, {{pain_points}}
```

---

## Verification

1. **Database:** Check `email_templates` table exists with default template
2. **API:** Test endpoints with curl:
   - `curl http://localhost:8001/api/templates`
   - `curl -X POST http://localhost:8001/api/templates -H "Content-Type: application/json" -d '{"name":"Test","category":"Test","subject":"Hi {{first_name}}","body":"Hello"}'`
3. **UI:**
   - Home tab shows Email Templates section
   - Can create/edit/delete templates
   - Contact modal shows template dropdown
   - Selecting template and clicking Email opens mailto with substituted content
