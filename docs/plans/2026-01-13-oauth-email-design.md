# OAuth Email Integration Design

## Overview

Send emails directly from Kanbun via Gmail or Outlook APIs with OAuth authentication. Replaces `mailto:` links with in-app compose and send functionality.

## Goals

1. **Send emails without leaving Kanbun** - In-app compose modal with to/cc/bcc/subject/body
2. **Support Gmail and Outlook** - Both providers with unified interface
3. **Secure token storage** - Encrypted refresh tokens in SQLite
4. **Educational for developers** - Clear code comments and README documentation

## Architecture

### File Structure

```
app/
├── services/
│   └── email/
│       ├── __init__.py      # Provider factory, get_email_provider()
│       ├── base.py          # Abstract EmailProvider base class
│       ├── gmail.py         # Google OAuth + Gmail API send
│       ├── outlook.py       # Microsoft OAuth + Graph API send
│       └── token_store.py   # Encrypted token CRUD operations
```

### Database Schema

New `email_accounts` table:

```sql
CREATE TABLE email_accounts (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,           -- 'gmail' or 'outlook'
    email TEXT NOT NULL,              -- user@example.com
    refresh_token_encrypted TEXT,     -- Fernet encrypted
    access_token_encrypted TEXT,      -- Cached, auto-refreshed
    token_expires_at INTEGER,         -- Unix timestamp
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### API Endpoints

```
GET  /api/email/auth/{provider}     → Redirect to OAuth consent screen
GET  /api/email/callback/{provider} → Handle OAuth callback, store tokens
GET  /api/email/status              → Get connected accounts
POST /api/email/disconnect          → Remove tokens for provider
POST /api/email/send                → Send email via specified provider
```

## OAuth Flow

1. User clicks "Connect Email" → selects Gmail or Outlook
2. Redirect to provider's OAuth consent screen
3. User authorizes Kanbun app
4. Callback receives auth code → exchange for tokens
5. Encrypt and store refresh token
6. Show "Connected: user@gmail.com" badge

### Token Lifecycle

- Access tokens expire (~1 hour for both providers)
- Auto-refresh before sending using stored refresh token
- If refresh fails (revoked), prompt user to reconnect

### Required Scopes

- **Gmail**: `https://www.googleapis.com/auth/gmail.send`
- **Outlook**: `https://graph.microsoft.com/Mail.Send`

## Compose Modal UI

```html
<div id="compose-email-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div class="bg-white rounded-lg p-6 max-w-2xl w-full mx-4">
    <h3 class="text-lg font-semibold mb-4">Compose Email</h3>

    <!-- To field - readonly, shows contact email -->
    <div class="mb-3">
      <label class="block text-sm text-gray-600 mb-1">To</label>
      <input id="email-to" readonly class="w-full border rounded px-3 py-2 bg-gray-50" />
    </div>

    <!-- CC field -->
    <div class="mb-3">
      <label class="block text-sm text-gray-600 mb-1">CC</label>
      <input id="email-cc" class="w-full border rounded px-3 py-2" placeholder="email@example.com" />
    </div>

    <!-- BCC field -->
    <div class="mb-3">
      <label class="block text-sm text-gray-600 mb-1">BCC</label>
      <input id="email-bcc" class="w-full border rounded px-3 py-2" placeholder="email@example.com" />
    </div>

    <!-- Subject -->
    <div class="mb-3">
      <label class="block text-sm text-gray-600 mb-1">Subject</label>
      <input id="email-subject" class="w-full border rounded px-3 py-2" />
    </div>

    <!-- Body -->
    <div class="mb-4">
      <label class="block text-sm text-gray-600 mb-1">Message</label>
      <textarea id="email-body" rows="10" class="w-full border rounded px-3 py-2"></textarea>
    </div>

    <!-- Actions -->
    <div class="flex justify-between items-center">
      <select id="send-provider" class="border rounded px-3 py-2">
        <!-- Populated based on connected accounts -->
      </select>
      <div class="flex gap-2">
        <button onclick="closeComposeModal()" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
        <button id="send-email-btn" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Send</button>
      </div>
    </div>
  </div>
</div>
```

## Security

### Token Encryption

- New env var: `EMAIL_ENCRYPTION_KEY`
- Uses Fernet symmetric encryption from `cryptography` library
- Key generation: `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

### Environment Variables

```bash
# Email OAuth Configuration
EMAIL_ENCRYPTION_KEY=your-fernet-key-here

# Gmail OAuth (from Google Cloud Console)
GMAIL_CLIENT_ID=your-client-id
GMAIL_CLIENT_SECRET=your-client-secret

# Outlook OAuth (from Azure Portal)
OUTLOOK_CLIENT_ID=your-client-id
OUTLOOK_CLIENT_SECRET=your-client-secret
```

## Dependencies

New packages to add to requirements.txt:

```
# Email OAuth
google-auth>=2.0.0
google-auth-oauthlib>=1.0.0
google-api-python-client>=2.0.0
msal>=1.20.0
cryptography>=41.0.0
```

## Template Integration

- Keep existing template system
- Template selection populates subject + body in compose modal
- User can edit before sending

## Success Feedback

- Toast notification on send success/failure
- No auto-logging to outreach timeline (can be added later)
