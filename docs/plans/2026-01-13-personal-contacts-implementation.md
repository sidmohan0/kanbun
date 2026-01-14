# Personal Contacts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add support for personal contacts (family, friends, acquaintances) with colorful visual treatment, iMessage support, and unified management alongside CRM contacts.

**Architecture:** Extend the existing contacts table with a `contact_type` column. Personal contacts use `stage='personal'` and have optional company. UI adds a Personal column to Kanban, filter to People tab, and Add Contact modal. Personal contact detail pages get colored accents based on relationship.

**Tech Stack:** FastAPI (Python), SQLite, Vanilla JavaScript, Tailwind CSS

---

## Task 1: Database Migration

**Files:**
- Modify: `app/database.py:150-168` (MIGRATIONS list)

**Step 1: Add contact_type migration**

Add this migration to the MIGRATIONS list in `app/database.py`:

```python
"ALTER TABLE contacts ADD COLUMN contact_type TEXT DEFAULT 'crm'",
```

**Step 2: Verify migration runs on startup**

Run the app briefly to trigger migration:

```bash
cd /Users/sid/projects/kanbun && python -c "import asyncio; from app.database import init_db; from app.config import settings; asyncio.run(init_db(settings.effective_database_path))"
```

Expected: No errors, column added to database.

**Step 3: Verify column exists**

```bash
sqlite3 /Users/sid/projects/kanbun/data/kanbun.db ".schema contacts" | grep contact_type
```

Expected: `contact_type TEXT DEFAULT 'crm'`

**Step 4: Commit**

```bash
git add app/database.py && git commit -m "feat: add contact_type column migration"
```

---

## Task 2: Update Valid Stages

**Files:**
- Modify: `app/main.py:76` (VALID_STAGES)

**Step 1: Add 'personal' to valid stages**

Change line 76 from:
```python
VALID_STAGES = {"backlog", "contacted", "reaching_out", "engaged", "meeting", "won", "lost", "naf"}
```

To:
```python
VALID_STAGES = {"backlog", "contacted", "reaching_out", "engaged", "meeting", "won", "lost", "naf", "personal"}
```

**Step 2: Commit**

```bash
git add app/main.py && git commit -m "feat: add personal stage to valid stages"
```

---

## Task 3: Create Contact Endpoint

**Files:**
- Modify: `app/main.py` (add new Pydantic model and endpoint after line 75)

**Step 1: Add ContactCreate Pydantic model**

Add after line 75 (after VALID_OUTREACH_TYPES):

```python
VALID_CONTACT_TYPES = {"crm", "personal"}
VALID_PERSONAL_RELATIONSHIPS = {"family", "friend", "acquaintance"}


class ContactCreate(BaseModel):
    first_name: str
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    contact_type: str = "personal"
    relationship: Optional[str] = None  # family, friend, acquaintance
    company_id: Optional[str] = None
    title: Optional[str] = None
    linkedin_url: Optional[str] = None
    notes: Optional[str] = None
```

**Step 2: Add POST /api/contacts endpoint**

Add before the `app.mount` line at the end of main.py:

```python
@app.post("/api/contacts")
async def create_contact(contact: ContactCreate):
    """Create a new contact (CRM or personal)."""
    if contact.contact_type not in VALID_CONTACT_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid contact_type. Must be one of: {', '.join(VALID_CONTACT_TYPES)}"
        )

    if contact.contact_type == "personal" and contact.relationship:
        if contact.relationship not in VALID_PERSONAL_RELATIONSHIPS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid relationship. Must be one of: {', '.join(VALID_PERSONAL_RELATIONSHIPS)}"
            )

    contact_id = str(uuid.uuid4())
    stage = "personal" if contact.contact_type == "personal" else "backlog"

    async with get_db(settings.effective_database_path) as db:
        # Verify company exists if provided
        if contact.company_id:
            cursor = await db.execute("SELECT id FROM companies WHERE id = ?", (contact.company_id,))
            if not await cursor.fetchone():
                raise HTTPException(status_code=404, detail="Company not found")

        await db.execute(
            """
            INSERT INTO contacts (id, first_name, last_name, email, phone, title,
                                  linkedin_url, company_id, stage, contact_type, relationship, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (contact_id, contact.first_name, contact.last_name, contact.email,
             contact.phone, contact.title, contact.linkedin_url, contact.company_id,
             stage, contact.contact_type, contact.relationship, contact.notes)
        )
        await db.commit()

        # Fetch the created contact with company info
        cursor = await db.execute(
            """
            SELECT ct.*, c.name as company_name
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
            WHERE ct.id = ?
            """,
            (contact_id,)
        )
        row = await cursor.fetchone()
        return dict(row)
```

**Step 3: Test the endpoint**

```bash
curl -X POST http://localhost:8000/api/contacts \
  -H "Content-Type: application/json" \
  -d '{"first_name": "Test", "last_name": "Person", "contact_type": "personal", "relationship": "friend"}'
```

Expected: Returns created contact with id, stage="personal", contact_type="personal"

**Step 4: Commit**

```bash
git add app/main.py && git commit -m "feat: add POST /api/contacts endpoint for creating contacts"
```

---

## Task 4: Update Pipeline Endpoint for Personal Contacts

**Files:**
- Modify: `app/main.py:1008-1046` (get_pipeline function)

**Step 1: Update get_pipeline to include personal stage**

Replace the get_pipeline function:

```python
@app.get("/api/pipeline")
async def get_pipeline():
    """Get all contacts grouped by stage with company info and next reminder."""
    async with get_db(settings.effective_database_path) as db:
        cursor = await db.execute(
            """
            SELECT
                ct.id,
                ct.first_name,
                ct.last_name,
                ct.email,
                ct.phone,
                ct.title,
                ct.contact_type,
                ct.relationship,
                c.name as company_name,
                ct.company_id,
                ct.stage,
                (
                    SELECT MIN(r.due_date)
                    FROM reminders r
                    WHERE r.contact_id = ct.id AND r.completed = 0
                ) as next_reminder
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
            ORDER BY ct.stage, ct.last_name
            """
        )
        rows = await cursor.fetchall()

        # Group by stage - include personal
        pipeline = {stage: [] for stage in VALID_STAGES}
        for row in rows:
            contact = dict(row)
            stage = contact.get("stage") or "backlog"
            if stage in pipeline:
                pipeline[stage].append(contact)
            else:
                pipeline["backlog"].append(contact)

        return pipeline
```

**Step 2: Commit**

```bash
git add app/main.py && git commit -m "feat: include contact_type and relationship in pipeline response"
```

---

## Task 5: Update Contacts List Endpoint with Filter

**Files:**
- Modify: `app/main.py:438-480` (get_all_contacts function)

**Step 1: Add contact_type filter parameter**

Update the function signature and query:

```python
@app.get("/api/database/contacts")
async def get_all_contacts(limit: int = 100, offset: int = 0, search: str = None, contact_type: str = None):
    async with get_db(settings.effective_database_path) as db:
        base_query = """
            SELECT ct.id, ct.first_name, ct.last_name, ct.email, ct.phone, ct.title,
                   ct.linkedin_url, ct.stage, ct.notes, ct.relationship, ct.company_id,
                   ct.contact_type,
                   c.name as company_name, c.website_url as company_website,
                   c.company_description, c.meta_title, c.meta_description
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
        """
        count_query = """
            SELECT COUNT(*) FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
        """
        params = []
        where_clauses = []

        if search:
            where_clauses.append("""
                (ct.first_name LIKE ? OR ct.last_name LIKE ?
                OR ct.email LIKE ? OR c.name LIKE ? OR ct.title LIKE ?)
            """)
            search_param = f"%{search}%"
            params.extend([search_param] * 5)

        if contact_type and contact_type in VALID_CONTACT_TYPES:
            where_clauses.append("ct.contact_type = ?")
            params.append(contact_type)

        if where_clauses:
            where_sql = " WHERE " + " AND ".join(where_clauses)
            base_query += where_sql
            count_query += where_sql

        base_query += " ORDER BY ct.created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        cursor = await db.execute(base_query, params)
        rows = await cursor.fetchall()

        # Count query params (without limit/offset)
        count_params = params[:-2]
        count_cursor = await db.execute(count_query, count_params)
        total = (await count_cursor.fetchone())[0]

        return {
            "contacts": [dict(row) for row in rows],
            "total": total,
            "limit": limit,
            "offset": offset
        }
```

**Step 2: Commit**

```bash
git add app/main.py && git commit -m "feat: add contact_type filter to contacts list endpoint"
```

---

## Task 6: Update Contact Full Endpoint

**Files:**
- Modify: `app/main.py:809-837` (get_contact_full function)

**Step 1: Include contact_type in response**

The SELECT * already includes all columns, so just verify it returns contact_type. No code change needed, but let's add explicit column for clarity:

Update the query in get_contact_full to explicitly select contact_type:

```python
@app.get("/api/contacts/{contact_id}/full")
async def get_contact_full(contact_id: str):
    """Get full contact details including company info."""
    async with get_db(settings.effective_database_path) as db:
        cursor = await db.execute(
            """
            SELECT
                ct.*,
                c.name as company_name,
                c.website_url as company_website,
                c.company_description,
                c.industry,
                c.headquarters,
                c.company_size,
                c.founded_year,
                c.meta_description,
                c.technologies,
                c.products_services
            FROM contacts ct
            LEFT JOIN companies c ON ct.company_id = c.id
            WHERE ct.id = ?
            """,
            (contact_id,)
        )
        row = await cursor.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Contact not found")

        return dict(row)
```

Note: The `ct.*` already includes contact_type and relationship. No change needed here.

**Step 2: Commit (skip if no changes)**

If no changes were made, skip this commit.

---

## Task 7: Add Personal Column to Kanban UI

**Files:**
- Modify: `app/static/index.html:169-227` (Kanban board HTML)

**Step 1: Add Personal column as leftmost column**

Insert this new column HTML right after the opening `<div class="flex gap-2" id="kanbanBoard">` line (line 170), before the backlog column:

```html
                <div class="kanban-column flex-1 min-w-0 rounded-xl p-2" style="background: linear-gradient(135deg, #fce7f3 0%, #dbeafe 50%, #d9f99d 100%);" data-stage="personal">
                    <h3 class="font-medium text-sage-700 mb-2 text-sm flex justify-between">
                        <span>Personal</span>
                        <span id="count-personal" class="text-sage-500">0</span>
                    </h3>
                    <div class="space-y-2 min-h-[150px]" id="column-personal"></div>
                </div>
```

**Step 2: Commit**

```bash
git add app/static/index.html && git commit -m "feat: add Personal column to Kanban board"
```

---

## Task 8: Update Pipeline JavaScript to Handle Personal Contacts

**Files:**
- Modify: `app/static/index.html` (loadPipeline function around line 2738)

**Step 1: Update stages array to include personal**

Find the loadPipeline function and update the stages array:

Change from:
```javascript
const stages = ['backlog', 'contacted', 'reaching_out', 'engaged', 'meeting', 'won', 'lost', 'naf'];
```

To:
```javascript
const stages = ['personal', 'backlog', 'contacted', 'reaching_out', 'engaged', 'meeting', 'won', 'lost', 'naf'];
```

**Step 2: Commit**

```bash
git add app/static/index.html && git commit -m "feat: update loadPipeline to include personal stage"
```

---

## Task 9: Create Personal Contact Card Rendering

**Files:**
- Modify: `app/static/index.html` (add createPersonalContactCard function near createContactCard)

**Step 1: Add relationship color helper and personal card function**

Add these functions right after the createContactCard function (around line 2803):

```javascript
        function getRelationshipColor(relationship) {
            const colors = {
                family: { bg: 'bg-rose-50', border: 'border-l-rose-400', text: 'text-rose-600', badge: 'bg-rose-100 text-rose-700' },
                friend: { bg: 'bg-blue-50', border: 'border-l-blue-400', text: 'text-blue-600', badge: 'bg-blue-100 text-blue-700' },
                acquaintance: { bg: 'bg-lime-50', border: 'border-l-lime-400', text: 'text-lime-600', badge: 'bg-lime-100 text-lime-700' }
            };
            return colors[relationship] || colors.acquaintance;
        }

        function createPersonalContactCard(contact) {
            const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';
            const colors = getRelationshipColor(contact.relationship);
            const relationshipLabel = contact.relationship
                ? contact.relationship.charAt(0).toUpperCase() + contact.relationship.slice(1)
                : '';

            return `
                <div class="${colors.bg} rounded-xl shadow-sm p-3 cursor-pointer hover:shadow-md transition-all hover:-translate-y-0.5 border border-cream-200 border-l-4 ${colors.border}"
                     data-contact-id="${contact.id}"
                     onclick="showContactDetail('${contact.id}')">
                    <div class="flex items-start justify-between">
                        <div class="flex-1 min-w-0">
                            <div class="font-medium text-sm text-sage-800">${name}</div>
                            ${relationshipLabel ? `<span class="inline-block mt-1 px-2 py-0.5 rounded-full text-xs ${colors.badge}">${relationshipLabel}</span>` : ''}
                        </div>
                        <div class="flex gap-1 ml-2">
                            ${contact.email ? `<a href="mailto:${contact.email}" onclick="event.stopPropagation()" class="text-sage-400 hover:text-terracotta-500" title="Email">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                            </a>` : ''}
                            ${contact.phone ? `<a href="sms:${contact.phone}" onclick="event.stopPropagation()" class="text-sage-400 hover:text-green-500" title="iMessage">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path></svg>
                            </a>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }
```

**Step 2: Commit**

```bash
git add app/static/index.html && git commit -m "feat: add personal contact card with colored styling"
```

---

## Task 10: Update loadPipeline to Use Personal Card for Personal Contacts

**Files:**
- Modify: `app/static/index.html` (loadPipeline function)

**Step 1: Update card rendering logic**

In the loadPipeline function, update the column rendering to use the correct card type:

Find this line:
```javascript
column.innerHTML = contacts.map(c => createContactCard(c)).join('');
```

Replace with:
```javascript
column.innerHTML = contacts.map(c =>
    c.contact_type === 'personal' ? createPersonalContactCard(c) : createContactCard(c)
).join('');
```

**Step 2: Disable drag for personal contacts**

Personal contacts shouldn't be draggable to other columns. The personal card already doesn't have `draggable="true"`, so this is handled.

**Step 3: Commit**

```bash
git add app/static/index.html && git commit -m "feat: render personal contacts with specialized cards"
```

---

## Task 11: Add Contact Modal HTML

**Files:**
- Modify: `app/static/index.html` (add modal HTML after existing modals)

**Step 1: Find existing modals location**

Search for existing modal HTML (like batch email modal) and add the new modal nearby.

**Step 2: Add Add Contact modal HTML**

Add this HTML after the batch email modal (around line 700):

```html
    <!-- Add Contact Modal -->
    <div id="addContactModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div class="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div class="p-6">
                <div class="flex justify-between items-center mb-4">
                    <h2 class="text-xl font-semibold text-sage-800">Add Contact</h2>
                    <button onclick="closeAddContactModal()" class="text-sage-400 hover:text-sage-600 text-2xl">&times;</button>
                </div>

                <!-- Contact Type Toggle -->
                <div class="flex gap-2 mb-4 p-1 bg-cream-100 rounded-lg">
                    <button id="addContactTypePersonal" onclick="setAddContactType('personal')"
                            class="flex-1 py-2 rounded-lg text-sm font-medium bg-white text-sage-700 shadow-sm">
                        Personal
                    </button>
                    <button id="addContactTypeCRM" onclick="setAddContactType('crm')"
                            class="flex-1 py-2 rounded-lg text-sm font-medium text-sage-600">
                        CRM
                    </button>
                </div>

                <form id="addContactForm" onsubmit="submitAddContact(event)">
                    <input type="hidden" id="addContactTypeValue" value="personal">

                    <!-- First Name (required) -->
                    <div class="mb-3">
                        <label class="block text-sm font-medium text-sage-700 mb-1">First Name *</label>
                        <input type="text" id="addContactFirstName" required
                               class="w-full border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300 focus:border-terracotta-300">
                    </div>

                    <!-- Last Name -->
                    <div class="mb-3">
                        <label class="block text-sm font-medium text-sage-700 mb-1">Last Name</label>
                        <input type="text" id="addContactLastName"
                               class="w-full border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300 focus:border-terracotta-300">
                    </div>

                    <!-- Relationship (personal only) -->
                    <div id="addContactRelationshipGroup" class="mb-3">
                        <label class="block text-sm font-medium text-sage-700 mb-1">Relationship</label>
                        <select id="addContactRelationship"
                                class="w-full border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300 focus:border-terracotta-300">
                            <option value="">Select...</option>
                            <option value="family">Family</option>
                            <option value="friend">Friend</option>
                            <option value="acquaintance">Acquaintance</option>
                        </select>
                    </div>

                    <!-- Company (CRM only) -->
                    <div id="addContactCompanyGroup" class="mb-3 hidden">
                        <label class="block text-sm font-medium text-sage-700 mb-1">Company</label>
                        <select id="addContactCompany"
                                class="w-full border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300 focus:border-terracotta-300">
                            <option value="">Select company...</option>
                        </select>
                    </div>

                    <!-- Title (CRM only) -->
                    <div id="addContactTitleGroup" class="mb-3 hidden">
                        <label class="block text-sm font-medium text-sage-700 mb-1">Title</label>
                        <input type="text" id="addContactTitle"
                               class="w-full border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300 focus:border-terracotta-300">
                    </div>

                    <!-- Email -->
                    <div class="mb-3">
                        <label class="block text-sm font-medium text-sage-700 mb-1">Email</label>
                        <input type="email" id="addContactEmail"
                               class="w-full border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300 focus:border-terracotta-300">
                    </div>

                    <!-- Phone -->
                    <div class="mb-3">
                        <label class="block text-sm font-medium text-sage-700 mb-1">Phone</label>
                        <input type="tel" id="addContactPhone"
                               class="w-full border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300 focus:border-terracotta-300">
                    </div>

                    <!-- LinkedIn -->
                    <div class="mb-3">
                        <label class="block text-sm font-medium text-sage-700 mb-1">LinkedIn URL</label>
                        <input type="url" id="addContactLinkedIn"
                               class="w-full border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300 focus:border-terracotta-300">
                    </div>

                    <!-- Notes -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-sage-700 mb-1">Notes</label>
                        <textarea id="addContactNotes" rows="2"
                                  class="w-full border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300 focus:border-terracotta-300"></textarea>
                    </div>

                    <!-- Submit -->
                    <div class="flex gap-2">
                        <button type="button" onclick="closeAddContactModal()"
                                class="flex-1 px-4 py-2 border border-cream-300 rounded-lg text-sage-600 hover:bg-cream-50">
                            Cancel
                        </button>
                        <button type="submit"
                                class="flex-1 px-4 py-2 bg-terracotta-500 text-white rounded-lg hover:bg-terracotta-600">
                            Add Contact
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
```

**Step 3: Commit**

```bash
git add app/static/index.html && git commit -m "feat: add Add Contact modal HTML"
```

---

## Task 12: Add Contact Modal JavaScript

**Files:**
- Modify: `app/static/index.html` (add JavaScript functions)

**Step 1: Add modal JavaScript functions**

Add these functions in the script section (near other modal functions):

```javascript
        // Add Contact Modal
        let addContactCompaniesCache = [];

        function openAddContactModal() {
            document.getElementById('addContactModal').classList.remove('hidden');
            document.getElementById('addContactForm').reset();
            setAddContactType('personal');
            loadCompaniesForAddContact();
        }

        function closeAddContactModal() {
            document.getElementById('addContactModal').classList.add('hidden');
        }

        function setAddContactType(type) {
            document.getElementById('addContactTypeValue').value = type;

            const personalBtn = document.getElementById('addContactTypePersonal');
            const crmBtn = document.getElementById('addContactTypeCRM');
            const relationshipGroup = document.getElementById('addContactRelationshipGroup');
            const companyGroup = document.getElementById('addContactCompanyGroup');
            const titleGroup = document.getElementById('addContactTitleGroup');

            if (type === 'personal') {
                personalBtn.classList.add('bg-white', 'text-sage-700', 'shadow-sm');
                personalBtn.classList.remove('text-sage-600');
                crmBtn.classList.remove('bg-white', 'text-sage-700', 'shadow-sm');
                crmBtn.classList.add('text-sage-600');
                relationshipGroup.classList.remove('hidden');
                companyGroup.classList.add('hidden');
                titleGroup.classList.add('hidden');
            } else {
                crmBtn.classList.add('bg-white', 'text-sage-700', 'shadow-sm');
                crmBtn.classList.remove('text-sage-600');
                personalBtn.classList.remove('bg-white', 'text-sage-700', 'shadow-sm');
                personalBtn.classList.add('text-sage-600');
                relationshipGroup.classList.add('hidden');
                companyGroup.classList.remove('hidden');
                titleGroup.classList.remove('hidden');
            }
        }

        async function loadCompaniesForAddContact() {
            try {
                const response = await fetch('/api/database/companies?limit=500');
                const data = await response.json();
                addContactCompaniesCache = data.companies || [];

                const select = document.getElementById('addContactCompany');
                select.innerHTML = '<option value="">Select company...</option>' +
                    addContactCompaniesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
            } catch (err) {
                console.error('Failed to load companies:', err);
            }
        }

        async function submitAddContact(event) {
            event.preventDefault();

            const contactType = document.getElementById('addContactTypeValue').value;
            const payload = {
                first_name: document.getElementById('addContactFirstName').value,
                last_name: document.getElementById('addContactLastName').value || null,
                email: document.getElementById('addContactEmail').value || null,
                phone: document.getElementById('addContactPhone').value || null,
                linkedin_url: document.getElementById('addContactLinkedIn').value || null,
                notes: document.getElementById('addContactNotes').value || null,
                contact_type: contactType
            };

            if (contactType === 'personal') {
                payload.relationship = document.getElementById('addContactRelationship').value || null;
            } else {
                payload.company_id = document.getElementById('addContactCompany').value || null;
                payload.title = document.getElementById('addContactTitle').value || null;
            }

            try {
                const response = await fetch('/api/contacts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const error = await response.json();
                    alert(error.detail || 'Failed to create contact');
                    return;
                }

                closeAddContactModal();
                // Refresh current view
                if (!document.getElementById('pipelineContent').classList.contains('hidden')) {
                    loadPipeline();
                } else if (!document.getElementById('databaseContent').classList.contains('hidden')) {
                    loadContacts();
                }
            } catch (err) {
                console.error('Failed to create contact:', err);
                alert('Failed to create contact');
            }
        }
```

**Step 2: Commit**

```bash
git add app/static/index.html && git commit -m "feat: add Add Contact modal JavaScript"
```

---

## Task 13: Add "Add Contact" Buttons to UI

**Files:**
- Modify: `app/static/index.html`

**Step 1: Add button to People tab header**

Find the People tab header (around line 307-316) and add the Add Contact button:

Change from:
```html
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">People</h2>
                <div class="flex space-x-2">
                    <button id="bulkScreenshotBtn" onclick="regenerateAllScreenshots()" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 text-sm">
                        Regenerate Screenshots
                    </button>
```

To:
```html
            <div class="flex justify-between items-center mb-4">
                <h2 class="text-xl font-semibold">People</h2>
                <div class="flex space-x-2">
                    <button onclick="openAddContactModal()" class="bg-terracotta-500 text-white px-4 py-2 rounded-lg hover:bg-terracotta-600 text-sm">
                        + Add Contact
                    </button>
                    <button id="bulkScreenshotBtn" onclick="regenerateAllScreenshots()" class="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600 text-sm">
                        Regenerate Screenshots
                    </button>
```

**Step 2: Add quick action to Home tab**

Find the Quick Actions section in the Home tab (around line 104-114) and add a new quick action card:

After the "View Pipeline" button (around line 113), add:

```html
                    <button onclick="openAddContactModal()" class="p-4 border-2 border-dashed border-cream-300 rounded-xl hover:border-terracotta-400 hover:bg-terracotta-50 transition-colors text-left">
                        <div class="font-medium text-sage-800">Add Contact</div>
                        <div class="text-sm text-sage-500">Add a new personal or CRM contact</div>
                    </button>
```

**Step 3: Commit**

```bash
git add app/static/index.html && git commit -m "feat: add Add Contact buttons to People tab and Home"
```

---

## Task 14: Add Contact Type Filter to People Tab

**Files:**
- Modify: `app/static/index.html`

**Step 1: Add filter dropdown to People tab search area**

Find the search/filter section in the People tab (around line 352-358) and add the filter dropdown:

Change from:
```html
            <div class="bg-white rounded-lg shadow p-4 mb-6">
                <div class="flex items-center space-x-4">
                    <input type="text" id="contactSearch" placeholder="Search by name, email, company..."
                           class="border rounded px-3 py-2 flex-1" onkeyup="debounceSearch()">
                    <span id="contactCount" class="text-gray-500 text-sm"></span>
                </div>
            </div>
```

To:
```html
            <div class="bg-white rounded-lg shadow p-4 mb-6">
                <div class="flex items-center space-x-4">
                    <select id="contactTypeFilter" onchange="loadContacts()"
                            class="border border-cream-300 rounded-lg px-3 py-2 text-sage-700 focus:ring-2 focus:ring-terracotta-300">
                        <option value="">All Contacts</option>
                        <option value="crm">CRM Contacts</option>
                        <option value="personal">Personal Contacts</option>
                    </select>
                    <input type="text" id="contactSearch" placeholder="Search by name, email, company..."
                           class="border rounded px-3 py-2 flex-1" onkeyup="debounceSearch()">
                    <span id="contactCount" class="text-gray-500 text-sm"></span>
                </div>
            </div>
```

**Step 2: Commit**

```bash
git add app/static/index.html && git commit -m "feat: add contact type filter dropdown to People tab"
```

---

## Task 15: Update loadContacts to Use Filter

**Files:**
- Modify: `app/static/index.html` (loadContacts function)

**Step 1: Find and update the loadContacts function**

Find the loadContacts function and update it to include the contact_type filter:

Find where it builds the fetch URL and update to include contact_type:

```javascript
        async function loadContacts() {
            const search = document.getElementById('contactSearch')?.value || '';
            const contactTypeFilter = document.getElementById('contactTypeFilter')?.value || '';

            let url = `/api/database/contacts?limit=${pageSize}&offset=${(currentPage - 1) * pageSize}`;
            if (search) url += `&search=${encodeURIComponent(search)}`;
            if (contactTypeFilter) url += `&contact_type=${encodeURIComponent(contactTypeFilter)}`;

            const response = await fetch(url);
            // ... rest of function
```

**Step 2: Commit**

```bash
git add app/static/index.html && git commit -m "feat: update loadContacts to use contact type filter"
```

---

## Task 16: Update People Table to Show Contact Type

**Files:**
- Modify: `app/static/index.html` (contacts table rendering)

**Step 1: Find and update the contacts table header**

Find the contacts table header (around line 362-372) and add a Type column:

Change the table header from:
```html
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-3 py-3 text-left w-16"></th>
                            <th class="px-4 py-3 text-left">Name</th>
                            <th class="px-4 py-3 text-left">Title</th>
                            <th class="px-4 py-3 text-left">Company</th>
```

To:
```html
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="px-3 py-3 text-left w-16"></th>
                            <th class="px-4 py-3 text-left">Name</th>
                            <th class="px-4 py-3 text-left">Type</th>
                            <th class="px-4 py-3 text-left">Title / Relationship</th>
                            <th class="px-4 py-3 text-left">Company</th>
```

**Step 2: Update the contacts table row rendering function**

Find where contact rows are rendered and update to include type badge. Look for the function that populates `contactsTableBody`.

Add a Type column cell and update Title column to show relationship for personal contacts:

```javascript
// In the row rendering, add type badge cell and update title/relationship display
const typeBadge = contact.contact_type === 'personal'
    ? '<span class="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">Personal</span>'
    : '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">CRM</span>';

const titleOrRelationship = contact.contact_type === 'personal'
    ? (contact.relationship ? contact.relationship.charAt(0).toUpperCase() + contact.relationship.slice(1) : '')
    : (contact.title || '');
```

**Step 3: Commit**

```bash
git add app/static/index.html && git commit -m "feat: update People table to show contact type"
```

---

## Task 17: Update Contact Detail Page for Personal Contacts

**Files:**
- Modify: `app/static/index.html` (renderContactPageDetails function)

**Step 1: Update header card to show colored accent for personal contacts**

Find the renderContactPageDetails function (around line 1424) and update it to apply colored accents for personal contacts:

At the start of the function, add color handling:

```javascript
        function renderContactPageDetails(contact) {
            const name = [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unknown';

            // Apply accent color for personal contacts
            const headerCard = document.getElementById('contactPageName').closest('.bg-white');
            if (contact.contact_type === 'personal') {
                const colors = getRelationshipColor(contact.relationship);
                headerCard.style.borderTop = '4px solid';
                headerCard.style.borderTopColor = contact.relationship === 'family' ? '#f43f5e'
                    : contact.relationship === 'friend' ? '#3b82f6' : '#84cc16';
            } else {
                headerCard.style.borderTop = 'none';
            }

            document.getElementById('contactPageName').textContent = name;
            // ... rest of existing code
```

**Step 2: Update details section to show relationship badge for personal contacts**

In the same function, update the title display:

```javascript
            // Show relationship badge for personal contacts, title for CRM
            if (contact.contact_type === 'personal' && contact.relationship) {
                const colors = getRelationshipColor(contact.relationship);
                const relationshipLabel = contact.relationship.charAt(0).toUpperCase() + contact.relationship.slice(1);
                document.getElementById('contactPageTitle').innerHTML =
                    `<span class="inline-block px-2 py-0.5 rounded-full text-sm ${colors.badge}">${relationshipLabel}</span>`;
            } else {
                document.getElementById('contactPageTitle').textContent = contact.title || '';
            }
```

**Step 3: Add iMessage button for personal contacts with phone**

Update the contact info section to include iMessage button:

```javascript
            if (contact.phone) {
                if (contact.contact_type === 'personal') {
                    detailsHtml += `<div class="flex items-center gap-2">
                        <span class="text-sage-600">${contact.phone}</span>
                        <a href="sms:${contact.phone}" class="text-green-500 hover:text-green-600 text-sm">iMessage</a>
                    </div>`;
                } else {
                    detailsHtml += `<div class="text-sage-600">${contact.phone}</div>`;
                }
            }
```

**Step 4: Commit**

```bash
git add app/static/index.html && git commit -m "feat: update contact detail page for personal contacts"
```

---

## Task 18: Hide CRM-specific UI for Personal Contacts

**Files:**
- Modify: `app/static/index.html` (renderContactPageDetails function)

**Step 1: Hide stage selector and outreach log for personal contacts**

In renderContactPageDetails, add logic to hide CRM-specific elements:

```javascript
            // Hide CRM-specific UI for personal contacts
            const stageCard = document.getElementById('contactPageStage').closest('.bg-white');
            const outreachSection = document.querySelector('[onclick*="contactPageLogOutreach"]')?.closest('.border-t');

            if (contact.contact_type === 'personal') {
                // Hide stage dropdown but keep relationship
                document.getElementById('contactPageStage').closest('div.mb-4')?.classList.add('hidden');
                // Hide outreach logging for personal contacts
                if (outreachSection) outreachSection.classList.add('hidden');
            } else {
                document.getElementById('contactPageStage').closest('div.mb-4')?.classList.remove('hidden');
                if (outreachSection) outreachSection.classList.remove('hidden');
            }
```

**Step 2: Commit**

```bash
git add app/static/index.html && git commit -m "feat: hide CRM-specific UI for personal contacts"
```

---

## Task 19: Update Timeline to Skip Outreach for Personal Contacts

**Files:**
- Modify: `app/static/index.html` (renderContactPageTimeline function)

**Step 1: Filter out outreach items for personal contacts**

Update the timeline rendering to conditionally show outreach:

```javascript
        function renderContactPageTimeline(timeline) {
            const container = document.getElementById('contactPageTimeline');
            const emptyState = document.getElementById('contactPageTimelineEmpty');

            // Filter timeline for personal contacts (no outreach)
            let filteredTimeline = timeline;
            if (currentContactPageData?.contact_type === 'personal') {
                filteredTimeline = timeline.filter(item => item.type !== 'outreach' && item.type !== 'stage_change');
            }

            if (!filteredTimeline || filteredTimeline.length === 0) {
                container.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }
            // ... rest of function uses filteredTimeline instead of timeline
```

**Step 2: Commit**

```bash
git add app/static/index.html && git commit -m "feat: filter outreach from personal contact timeline"
```

---

## Task 20: Final Testing and Polish

**Step 1: Start the server**

```bash
cd /Users/sid/projects/kanbun && python -m uvicorn app.main:app --reload
```

**Step 2: Test creating a personal contact**

1. Open http://localhost:8000
2. Click "Add Contact" on Home tab
3. Fill in: First Name "Mom", Relationship "family", Phone number
4. Submit
5. Verify contact appears in Personal column on Pipeline

**Step 3: Test personal contact detail page**

1. Click on the personal contact card
2. Verify rose/pink accent on header
3. Verify "Family" badge is shown
4. Verify iMessage link appears next to phone
5. Verify stage selector is hidden
6. Verify outreach log buttons are hidden

**Step 4: Test filter on People tab**

1. Go to People tab
2. Use filter dropdown to show "Personal Contacts"
3. Verify only personal contacts shown
4. Verify Type column shows "Personal" badge

**Step 5: Commit any fixes**

```bash
git add -A && git commit -m "polish: final adjustments for personal contacts feature"
```

---

## Summary

This implementation adds:
1. Database: `contact_type` column with migration
2. Backend: `POST /api/contacts`, updated pipeline/contacts endpoints with filter
3. Frontend: Personal column in Kanban, Add Contact modal, filter dropdown, personal contact cards with colors, updated detail page with iMessage

All existing CRM functionality remains unchanged. Personal contacts integrate naturally alongside CRM contacts.
