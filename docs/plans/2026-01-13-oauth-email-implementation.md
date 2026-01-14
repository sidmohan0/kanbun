# OAuth Email Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Send emails directly from Kanbun via Gmail or Outlook APIs with OAuth authentication.

**Architecture:** Modular email service with provider-specific implementations (Gmail, Outlook), encrypted token storage in SQLite, and in-app compose modal UI.

**Tech Stack:** FastAPI, google-auth, google-api-python-client, msal, cryptography (Fernet), vanilla JavaScript

---

## Task 1: Add Dependencies

**Files:**
- Modify: `requirements.txt`

**Step 1: Add email OAuth packages**

Add to requirements.txt:
```
# Email OAuth
google-auth>=2.0.0
google-auth-oauthlib>=1.0.0
google-api-python-client>=2.0.0
msal>=1.20.0
cryptography>=41.0.0
```

**Step 2: Install dependencies**

Run: `pip install -r requirements.txt`
Expected: All packages install successfully

**Step 3: Commit**

```bash
git add requirements.txt
git commit -m "feat: add email OAuth dependencies"
```

---

## Task 2: Add Email Configuration to Config

**Files:**
- Modify: `app/config.py`
- Modify: `.env.example`

**Step 1: Add email config settings**

In `app/config.py`, add new settings:
```python
# Email OAuth Configuration
EMAIL_ENCRYPTION_KEY: str = ""  # Fernet key for token encryption

# Gmail OAuth
GMAIL_CLIENT_ID: str = ""
GMAIL_CLIENT_SECRET: str = ""
GMAIL_REDIRECT_URI: str = "http://localhost:8000/api/email/callback/gmail"

# Outlook OAuth
OUTLOOK_CLIENT_ID: str = ""
OUTLOOK_CLIENT_SECRET: str = ""
OUTLOOK_REDIRECT_URI: str = "http://localhost:8000/api/email/callback/outlook"
```

**Step 2: Update .env.example with documentation**

Add to `.env.example`:
```bash
# ===========================================
# Email OAuth Configuration (Optional)
# ===========================================
# Enable direct email sending from Kanbun via Gmail or Outlook.
# Follow the setup guide in README.md to configure.

# Encryption key for storing OAuth tokens securely
# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
EMAIL_ENCRYPTION_KEY=

# Gmail OAuth (from Google Cloud Console > APIs & Services > Credentials)
# 1. Create OAuth 2.0 Client ID (Web application)
# 2. Add redirect URI: http://localhost:8000/api/email/callback/gmail
# 3. Enable Gmail API in your project
GMAIL_CLIENT_ID=
GMAIL_CLIENT_SECRET=

# Outlook OAuth (from Azure Portal > App registrations)
# 1. Register new application
# 2. Add redirect URI: http://localhost:8000/api/email/callback/outlook (Web platform)
# 3. Add API permission: Microsoft Graph > Mail.Send
OUTLOOK_CLIENT_ID=
OUTLOOK_CLIENT_SECRET=
```

**Step 3: Commit**

```bash
git add app/config.py .env.example
git commit -m "feat: add email OAuth configuration settings"
```

---

## Task 3: Create Database Migration for email_accounts Table

**Files:**
- Modify: `app/database.py`

**Step 1: Add migration**

Add to the `MIGRATIONS` list in `app/database.py`:
```python
# Email OAuth tokens table
"""
CREATE TABLE IF NOT EXISTS email_accounts (
    id INTEGER PRIMARY KEY,
    provider TEXT NOT NULL,
    email TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    access_token_encrypted TEXT,
    token_expires_at INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
""",
```

**Step 2: Test migration runs**

Run: `uvicorn app.main:app --reload`
Check logs for successful table creation

**Step 3: Commit**

```bash
git add app/database.py
git commit -m "feat: add email_accounts table migration"
```

---

## Task 4: Create Token Store Service

**Files:**
- Create: `app/services/email/__init__.py`
- Create: `app/services/email/token_store.py`

**Step 1: Create email services directory and __init__.py**

Create `app/services/email/__init__.py`:
```python
"""
Email service module for OAuth-based email sending.

Supports Gmail and Outlook providers with encrypted token storage.
"""

from .token_store import TokenStore
from .base import EmailProvider

__all__ = ["TokenStore", "EmailProvider"]
```

**Step 2: Create token_store.py with Fernet encryption**

Create `app/services/email/token_store.py`:
```python
"""
Encrypted token storage for OAuth refresh/access tokens.

Uses Fernet symmetric encryption with key from EMAIL_ENCRYPTION_KEY env var.
Tokens are stored in the email_accounts SQLite table.
"""

from cryptography.fernet import Fernet
from typing import Optional
import aiosqlite
import time

from app.config import settings


class TokenStore:
    """Handles encrypted storage and retrieval of OAuth tokens."""

    def __init__(self):
        # Fernet cipher for encryption/decryption
        # Key must be 32 url-safe base64-encoded bytes
        if settings.EMAIL_ENCRYPTION_KEY:
            self._cipher = Fernet(settings.EMAIL_ENCRYPTION_KEY.encode())
        else:
            self._cipher = None

    def _encrypt(self, plaintext: str) -> str:
        """Encrypt a string using Fernet. Returns base64-encoded ciphertext."""
        if not self._cipher:
            raise ValueError("EMAIL_ENCRYPTION_KEY not configured")
        return self._cipher.encrypt(plaintext.encode()).decode()

    def _decrypt(self, ciphertext: str) -> str:
        """Decrypt a Fernet-encrypted string."""
        if not self._cipher:
            raise ValueError("EMAIL_ENCRYPTION_KEY not configured")
        return self._cipher.decrypt(ciphertext.encode()).decode()

    async def save_tokens(
        self,
        db: aiosqlite.Connection,
        provider: str,
        email: str,
        refresh_token: str,
        access_token: str,
        expires_at: int
    ) -> None:
        """
        Save or update OAuth tokens for a provider.

        Args:
            db: Database connection
            provider: 'gmail' or 'outlook'
            email: User's email address
            refresh_token: OAuth refresh token (will be encrypted)
            access_token: OAuth access token (will be encrypted)
            expires_at: Unix timestamp when access token expires
        """
        refresh_encrypted = self._encrypt(refresh_token)
        access_encrypted = self._encrypt(access_token)

        # Upsert - delete existing for this provider, then insert
        await db.execute("DELETE FROM email_accounts WHERE provider = ?", (provider,))
        await db.execute(
            """
            INSERT INTO email_accounts
            (provider, email, refresh_token_encrypted, access_token_encrypted, token_expires_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (provider, email, refresh_encrypted, access_encrypted, expires_at)
        )
        await db.commit()

    async def get_tokens(
        self,
        db: aiosqlite.Connection,
        provider: str
    ) -> Optional[dict]:
        """
        Retrieve decrypted tokens for a provider.

        Returns dict with: email, refresh_token, access_token, expires_at
        Returns None if no tokens stored for this provider.
        """
        async with db.execute(
            """
            SELECT email, refresh_token_encrypted, access_token_encrypted, token_expires_at
            FROM email_accounts WHERE provider = ?
            """,
            (provider,)
        ) as cursor:
            row = await cursor.fetchone()

        if not row:
            return None

        return {
            "email": row[0],
            "refresh_token": self._decrypt(row[1]),
            "access_token": self._decrypt(row[2]),
            "expires_at": row[3]
        }

    async def update_access_token(
        self,
        db: aiosqlite.Connection,
        provider: str,
        access_token: str,
        expires_at: int
    ) -> None:
        """Update just the access token (after refresh)."""
        access_encrypted = self._encrypt(access_token)
        await db.execute(
            """
            UPDATE email_accounts
            SET access_token_encrypted = ?, token_expires_at = ?
            WHERE provider = ?
            """,
            (access_encrypted, expires_at, provider)
        )
        await db.commit()

    async def delete_tokens(self, db: aiosqlite.Connection, provider: str) -> None:
        """Remove all tokens for a provider (disconnect)."""
        await db.execute("DELETE FROM email_accounts WHERE provider = ?", (provider,))
        await db.commit()

    async def get_all_accounts(self, db: aiosqlite.Connection) -> list[dict]:
        """Get list of connected accounts (without tokens, just provider and email)."""
        async with db.execute(
            "SELECT provider, email FROM email_accounts"
        ) as cursor:
            rows = await cursor.fetchall()
        return [{"provider": row[0], "email": row[1]} for row in rows]

    def is_token_expired(self, expires_at: int, buffer_seconds: int = 300) -> bool:
        """Check if token is expired (with 5 minute buffer by default)."""
        return time.time() > (expires_at - buffer_seconds)
```

**Step 3: Commit**

```bash
git add app/services/email/
git commit -m "feat: add encrypted token store for OAuth"
```

---

## Task 5: Create Base Email Provider Class

**Files:**
- Create: `app/services/email/base.py`

**Step 1: Create abstract base class**

Create `app/services/email/base.py`:
```python
"""
Abstract base class for email providers.

All email providers (Gmail, Outlook) inherit from this class
and implement the required methods for OAuth and sending.
"""

from abc import ABC, abstractmethod
from typing import Optional
import aiosqlite

from .token_store import TokenStore


class EmailProvider(ABC):
    """
    Abstract base class for email providers.

    Subclasses must implement:
    - get_auth_url(): Generate OAuth authorization URL
    - handle_callback(): Exchange auth code for tokens
    - send_email(): Send an email
    - refresh_access_token(): Refresh expired access token
    """

    def __init__(self):
        self.token_store = TokenStore()

    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return provider name ('gmail' or 'outlook')."""
        pass

    @abstractmethod
    def get_auth_url(self, state: Optional[str] = None) -> str:
        """
        Generate OAuth authorization URL.

        Args:
            state: Optional state parameter for CSRF protection

        Returns:
            URL to redirect user to for OAuth consent
        """
        pass

    @abstractmethod
    async def handle_callback(
        self,
        db: aiosqlite.Connection,
        code: str
    ) -> dict:
        """
        Handle OAuth callback - exchange code for tokens.

        Args:
            db: Database connection for storing tokens
            code: Authorization code from OAuth callback

        Returns:
            dict with user's email address
        """
        pass

    @abstractmethod
    async def send_email(
        self,
        db: aiosqlite.Connection,
        to: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None
    ) -> dict:
        """
        Send an email.

        Args:
            db: Database connection for token retrieval
            to: Recipient email address
            subject: Email subject
            body: Email body (plain text)
            cc: Optional CC recipients (comma-separated)
            bcc: Optional BCC recipients (comma-separated)

        Returns:
            dict with send status and any message ID
        """
        pass

    @abstractmethod
    async def refresh_access_token(self, db: aiosqlite.Connection) -> str:
        """
        Refresh the access token using stored refresh token.

        Args:
            db: Database connection

        Returns:
            New access token
        """
        pass

    async def get_valid_access_token(self, db: aiosqlite.Connection) -> str:
        """
        Get a valid access token, refreshing if expired.

        This is a convenience method that handles token refresh automatically.
        """
        tokens = await self.token_store.get_tokens(db, self.provider_name)
        if not tokens:
            raise ValueError(f"No {self.provider_name} account connected")

        if self.token_store.is_token_expired(tokens["expires_at"]):
            return await self.refresh_access_token(db)

        return tokens["access_token"]
```

**Step 2: Commit**

```bash
git add app/services/email/base.py
git commit -m "feat: add abstract EmailProvider base class"
```

---

## Task 6: Implement Gmail Provider

**Files:**
- Create: `app/services/email/gmail.py`

**Step 1: Create Gmail provider implementation**

Create `app/services/email/gmail.py`:
```python
"""
Gmail OAuth provider implementation.

Uses Google OAuth 2.0 for authentication and Gmail API for sending.
Requires GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in environment.

Setup instructions:
1. Go to Google Cloud Console > APIs & Services > Credentials
2. Create OAuth 2.0 Client ID (Web application type)
3. Add authorized redirect URI: http://localhost:8000/api/email/callback/gmail
4. Enable Gmail API for your project
"""

from typing import Optional
import aiosqlite
import time
import base64
from email.mime.text import MIMEText

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.config import settings
from .base import EmailProvider


# OAuth scopes - only request send permission
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


class GmailProvider(EmailProvider):
    """Gmail implementation using Google OAuth 2.0 and Gmail API."""

    @property
    def provider_name(self) -> str:
        return "gmail"

    def _get_flow(self) -> Flow:
        """Create OAuth flow with client credentials."""
        client_config = {
            "web": {
                "client_id": settings.GMAIL_CLIENT_ID,
                "client_secret": settings.GMAIL_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GMAIL_REDIRECT_URI]
            }
        }
        return Flow.from_client_config(
            client_config,
            scopes=SCOPES,
            redirect_uri=settings.GMAIL_REDIRECT_URI
        )

    def get_auth_url(self, state: Optional[str] = None) -> str:
        """Generate Google OAuth consent URL."""
        flow = self._get_flow()
        auth_url, _ = flow.authorization_url(
            access_type="offline",  # Request refresh token
            include_granted_scopes="true",
            prompt="consent",  # Always show consent screen to get refresh token
            state=state
        )
        return auth_url

    async def handle_callback(
        self,
        db: aiosqlite.Connection,
        code: str
    ) -> dict:
        """Exchange authorization code for tokens and store them."""
        flow = self._get_flow()
        flow.fetch_token(code=code)

        credentials = flow.credentials

        # Get user's email address
        service = build("gmail", "v1", credentials=credentials)
        profile = service.users().getProfile(userId="me").execute()
        email = profile["emailAddress"]

        # Calculate expiry timestamp
        expires_at = int(time.time()) + 3600  # Google tokens typically last 1 hour

        # Store encrypted tokens
        await self.token_store.save_tokens(
            db=db,
            provider=self.provider_name,
            email=email,
            refresh_token=credentials.refresh_token,
            access_token=credentials.token,
            expires_at=expires_at
        )

        return {"email": email}

    async def refresh_access_token(self, db: aiosqlite.Connection) -> str:
        """Refresh access token using stored refresh token."""
        tokens = await self.token_store.get_tokens(db, self.provider_name)
        if not tokens:
            raise ValueError("No Gmail account connected")

        # Create credentials object with refresh token
        credentials = Credentials(
            token=tokens["access_token"],
            refresh_token=tokens["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GMAIL_CLIENT_ID,
            client_secret=settings.GMAIL_CLIENT_SECRET,
            scopes=SCOPES
        )

        # Force refresh
        credentials.refresh(None)

        # Update stored access token
        expires_at = int(time.time()) + 3600
        await self.token_store.update_access_token(
            db=db,
            provider=self.provider_name,
            access_token=credentials.token,
            expires_at=expires_at
        )

        return credentials.token

    async def send_email(
        self,
        db: aiosqlite.Connection,
        to: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None
    ) -> dict:
        """
        Send email via Gmail API.

        Creates a MIME message and sends via users.messages.send().
        """
        # Get valid access token (auto-refreshes if needed)
        tokens = await self.token_store.get_tokens(db, self.provider_name)
        if not tokens:
            raise ValueError("No Gmail account connected")

        # Check if token needs refresh
        if self.token_store.is_token_expired(tokens["expires_at"]):
            await self.refresh_access_token(db)
            tokens = await self.token_store.get_tokens(db, self.provider_name)

        # Build credentials and service
        credentials = Credentials(
            token=tokens["access_token"],
            refresh_token=tokens["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.GMAIL_CLIENT_ID,
            client_secret=settings.GMAIL_CLIENT_SECRET,
            scopes=SCOPES
        )

        service = build("gmail", "v1", credentials=credentials)

        # Create MIME message
        message = MIMEText(body)
        message["to"] = to
        message["subject"] = subject
        message["from"] = tokens["email"]

        if cc:
            message["cc"] = cc
        if bcc:
            message["bcc"] = bcc

        # Encode for Gmail API
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()

        try:
            result = service.users().messages().send(
                userId="me",
                body={"raw": raw}
            ).execute()

            return {
                "success": True,
                "message_id": result.get("id"),
                "provider": "gmail"
            }
        except HttpError as e:
            return {
                "success": False,
                "error": str(e),
                "provider": "gmail"
            }
```

**Step 2: Commit**

```bash
git add app/services/email/gmail.py
git commit -m "feat: implement Gmail OAuth provider"
```

---

## Task 7: Implement Outlook Provider

**Files:**
- Create: `app/services/email/outlook.py`

**Step 1: Create Outlook provider implementation**

Create `app/services/email/outlook.py`:
```python
"""
Outlook OAuth provider implementation.

Uses Microsoft OAuth 2.0 (via MSAL) and Microsoft Graph API for sending.
Requires OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET in environment.

Setup instructions:
1. Go to Azure Portal > App registrations > New registration
2. Name: "Kanbun Email" (or similar)
3. Supported account types: Personal Microsoft accounts only (or multi-tenant for work accounts)
4. Redirect URI: Web - http://localhost:8000/api/email/callback/outlook
5. Go to Certificates & secrets > New client secret
6. Go to API permissions > Add permission > Microsoft Graph > Delegated > Mail.Send
"""

from typing import Optional
import aiosqlite
import time
import httpx
import msal

from app.config import settings
from .base import EmailProvider


# OAuth scopes for Microsoft Graph
SCOPES = ["https://graph.microsoft.com/Mail.Send", "https://graph.microsoft.com/User.Read"]


class OutlookProvider(EmailProvider):
    """Outlook implementation using Microsoft OAuth 2.0 and Graph API."""

    @property
    def provider_name(self) -> str:
        return "outlook"

    def _get_msal_app(self) -> msal.ConfidentialClientApplication:
        """Create MSAL application instance."""
        return msal.ConfidentialClientApplication(
            client_id=settings.OUTLOOK_CLIENT_ID,
            client_credential=settings.OUTLOOK_CLIENT_SECRET,
            authority="https://login.microsoftonline.com/common"
        )

    def get_auth_url(self, state: Optional[str] = None) -> str:
        """Generate Microsoft OAuth consent URL."""
        app = self._get_msal_app()
        auth_url = app.get_authorization_request_url(
            scopes=SCOPES,
            redirect_uri=settings.OUTLOOK_REDIRECT_URI,
            state=state
        )
        return auth_url

    async def handle_callback(
        self,
        db: aiosqlite.Connection,
        code: str
    ) -> dict:
        """Exchange authorization code for tokens and store them."""
        app = self._get_msal_app()

        # Exchange code for tokens
        result = app.acquire_token_by_authorization_code(
            code=code,
            scopes=SCOPES,
            redirect_uri=settings.OUTLOOK_REDIRECT_URI
        )

        if "error" in result:
            raise ValueError(f"OAuth error: {result.get('error_description', result['error'])}")

        access_token = result["access_token"]
        refresh_token = result.get("refresh_token", "")

        # Get user's email via Graph API
        async with httpx.AsyncClient() as client:
            response = await client.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"}
            )
            user_data = response.json()

        email = user_data.get("mail") or user_data.get("userPrincipalName")

        # Calculate expiry (MSAL gives expires_in in seconds)
        expires_at = int(time.time()) + result.get("expires_in", 3600)

        # Store encrypted tokens
        await self.token_store.save_tokens(
            db=db,
            provider=self.provider_name,
            email=email,
            refresh_token=refresh_token,
            access_token=access_token,
            expires_at=expires_at
        )

        return {"email": email}

    async def refresh_access_token(self, db: aiosqlite.Connection) -> str:
        """Refresh access token using stored refresh token."""
        tokens = await self.token_store.get_tokens(db, self.provider_name)
        if not tokens:
            raise ValueError("No Outlook account connected")

        app = self._get_msal_app()

        # Use MSAL to refresh token
        result = app.acquire_token_by_refresh_token(
            refresh_token=tokens["refresh_token"],
            scopes=SCOPES
        )

        if "error" in result:
            raise ValueError(f"Token refresh failed: {result.get('error_description', result['error'])}")

        # Update stored access token
        expires_at = int(time.time()) + result.get("expires_in", 3600)
        await self.token_store.update_access_token(
            db=db,
            provider=self.provider_name,
            access_token=result["access_token"],
            expires_at=expires_at
        )

        return result["access_token"]

    async def send_email(
        self,
        db: aiosqlite.Connection,
        to: str,
        subject: str,
        body: str,
        cc: Optional[str] = None,
        bcc: Optional[str] = None
    ) -> dict:
        """
        Send email via Microsoft Graph API.

        Uses the /me/sendMail endpoint.
        """
        # Get valid access token (auto-refreshes if needed)
        access_token = await self.get_valid_access_token(db)

        # Build Graph API message payload
        message = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": "Text",
                    "content": body
                },
                "toRecipients": [
                    {"emailAddress": {"address": addr.strip()}}
                    for addr in to.split(",")
                ]
            },
            "saveToSentItems": True
        }

        # Add CC recipients if provided
        if cc:
            message["message"]["ccRecipients"] = [
                {"emailAddress": {"address": addr.strip()}}
                for addr in cc.split(",")
            ]

        # Add BCC recipients if provided
        if bcc:
            message["message"]["bccRecipients"] = [
                {"emailAddress": {"address": addr.strip()}}
                for addr in bcc.split(",")
            ]

        # Send via Graph API
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://graph.microsoft.com/v1.0/me/sendMail",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json"
                },
                json=message
            )

        if response.status_code == 202:  # Accepted
            return {
                "success": True,
                "message_id": None,  # Graph API doesn't return message ID for sendMail
                "provider": "outlook"
            }
        else:
            return {
                "success": False,
                "error": response.text,
                "provider": "outlook"
            }
```

**Step 2: Commit**

```bash
git add app/services/email/outlook.py
git commit -m "feat: implement Outlook OAuth provider"
```

---

## Task 8: Update Email Module Exports

**Files:**
- Modify: `app/services/email/__init__.py`

**Step 1: Add provider imports and factory function**

Update `app/services/email/__init__.py`:
```python
"""
Email service module for OAuth-based email sending.

Supports Gmail and Outlook providers with encrypted token storage.

Usage:
    provider = get_email_provider("gmail")
    auth_url = provider.get_auth_url()
    # ... user completes OAuth ...
    await provider.send_email(db, "to@example.com", "Subject", "Body")
"""

from .token_store import TokenStore
from .base import EmailProvider
from .gmail import GmailProvider
from .outlook import OutlookProvider


def get_email_provider(provider_name: str) -> EmailProvider:
    """
    Factory function to get email provider instance.

    Args:
        provider_name: 'gmail' or 'outlook'

    Returns:
        EmailProvider instance

    Raises:
        ValueError: If provider_name is not recognized
    """
    providers = {
        "gmail": GmailProvider,
        "outlook": OutlookProvider
    }

    if provider_name not in providers:
        raise ValueError(f"Unknown email provider: {provider_name}. Supported: {list(providers.keys())}")

    return providers[provider_name]()


__all__ = [
    "TokenStore",
    "EmailProvider",
    "GmailProvider",
    "OutlookProvider",
    "get_email_provider"
]
```

**Step 2: Commit**

```bash
git add app/services/email/__init__.py
git commit -m "feat: add provider factory function to email module"
```

---

## Task 9: Add Email API Endpoints

**Files:**
- Modify: `app/main.py`

**Step 1: Add email imports at top of file**

Add to imports in `app/main.py`:
```python
from app.services.email import get_email_provider, TokenStore
```

**Step 2: Add Pydantic model for email sending**

Add after other Pydantic models:
```python
class EmailSend(BaseModel):
    provider: str  # 'gmail' or 'outlook'
    to: str
    subject: str
    body: str
    cc: Optional[str] = None
    bcc: Optional[str] = None
```

**Step 3: Add OAuth initiation endpoint**

Add endpoint:
```python
@app.get("/api/email/auth/{provider}")
async def email_auth(provider: str):
    """
    Start OAuth flow for email provider.

    Redirects user to provider's consent screen.
    After consent, user is redirected to /api/email/callback/{provider}.
    """
    if provider not in ["gmail", "outlook"]:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    email_provider = get_email_provider(provider)
    auth_url = email_provider.get_auth_url()

    return RedirectResponse(url=auth_url)
```

**Step 4: Add OAuth callback endpoint**

Add endpoint:
```python
@app.get("/api/email/callback/{provider}")
async def email_callback(provider: str, code: str = None, error: str = None):
    """
    Handle OAuth callback from email provider.

    Exchanges authorization code for tokens and stores them.
    Redirects back to app with success/error status.
    """
    if error:
        # User denied or error occurred
        return RedirectResponse(url=f"/?email_error={error}")

    if not code:
        raise HTTPException(status_code=400, detail="No authorization code provided")

    if provider not in ["gmail", "outlook"]:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    email_provider = get_email_provider(provider)

    async with aiosqlite.connect(DATABASE_PATH) as db:
        try:
            result = await email_provider.handle_callback(db, code)
            email = result["email"]
            return RedirectResponse(url=f"/?email_connected={provider}&email={email}")
        except Exception as e:
            return RedirectResponse(url=f"/?email_error={str(e)}")
```

**Step 5: Add email status endpoint**

Add endpoint:
```python
@app.get("/api/email/status")
async def email_status():
    """
    Get status of connected email accounts.

    Returns list of connected providers and email addresses.
    """
    token_store = TokenStore()

    async with aiosqlite.connect(DATABASE_PATH) as db:
        accounts = await token_store.get_all_accounts(db)

    return {"accounts": accounts}
```

**Step 6: Add disconnect endpoint**

Add endpoint:
```python
@app.post("/api/email/disconnect")
async def email_disconnect(provider: str):
    """
    Disconnect an email account by removing stored tokens.
    """
    if provider not in ["gmail", "outlook"]:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")

    token_store = TokenStore()

    async with aiosqlite.connect(DATABASE_PATH) as db:
        await token_store.delete_tokens(db, provider)

    return {"status": "disconnected", "provider": provider}
```

**Step 7: Add send email endpoint**

Add endpoint:
```python
@app.post("/api/email/send")
async def send_email(email_data: EmailSend):
    """
    Send an email via connected provider.

    Requires the specified provider to be connected via OAuth.
    """
    if email_data.provider not in ["gmail", "outlook"]:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {email_data.provider}")

    email_provider = get_email_provider(email_data.provider)

    async with aiosqlite.connect(DATABASE_PATH) as db:
        try:
            result = await email_provider.send_email(
                db=db,
                to=email_data.to,
                subject=email_data.subject,
                body=email_data.body,
                cc=email_data.cc,
                bcc=email_data.bcc
            )

            if result["success"]:
                return result
            else:
                raise HTTPException(status_code=500, detail=result["error"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
```

**Step 8: Commit**

```bash
git add app/main.py
git commit -m "feat: add email OAuth API endpoints"
```

---

## Task 10: Add Email Connection UI

**Files:**
- Modify: `app/static/index.html`

**Step 1: Add email connection status in header**

Find the header area and add email status indicator. Look for a good place near the top of the page, perhaps near any existing settings or account indicators.

Add HTML:
```html
<!-- Email Connection Status -->
<div id="email-status" class="flex items-center gap-2">
    <span class="text-sm text-gray-500">Email:</span>
    <span id="email-status-text" class="text-sm">Not connected</span>
    <button id="connect-email-btn" onclick="showEmailConnectModal()" class="text-blue-600 hover:text-blue-800 text-sm">
        Connect
    </button>
</div>
```

**Step 2: Add email connect modal HTML**

Add modal HTML before closing </body>:
```html
<!-- Email Connect Modal -->
<div id="email-connect-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg p-6 max-w-md w-full mx-4">
        <h3 class="text-lg font-semibold mb-4">Connect Email Account</h3>
        <p class="text-gray-600 mb-4">Connect your email to send messages directly from Kanbun.</p>

        <div class="space-y-3">
            <button onclick="connectEmail('gmail')" class="w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-lg hover:bg-gray-50 transition-colors">
                <svg class="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#EA4335" d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115Z"/>
                    <path fill="#34A853" d="M16.04 18.013c-1.09.703-2.474 1.078-4.04 1.078a7.077 7.077 0 0 1-6.723-4.823l-4.04 3.067A11.965 11.965 0 0 0 12 24c2.933 0 5.735-1.043 7.834-3l-3.793-2.987Z"/>
                    <path fill="#4A90E2" d="M19.834 21c2.195-2.048 3.62-5.096 3.62-9 0-.71-.109-1.473-.272-2.182H12v4.637h6.436c-.317 1.559-1.17 2.766-2.395 3.558L19.834 21Z"/>
                    <path fill="#FBBC05" d="M5.277 14.268A7.12 7.12 0 0 1 4.909 12c0-.782.125-1.533.357-2.235L1.24 6.65A11.934 11.934 0 0 0 0 12c0 1.92.445 3.73 1.237 5.335l4.04-3.067Z"/>
                </svg>
                <span>Connect Gmail</span>
            </button>

            <button onclick="connectEmail('outlook')" class="w-full flex items-center justify-center gap-2 px-4 py-3 border rounded-lg hover:bg-gray-50 transition-colors">
                <svg class="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#0078D4" d="M0 0h11.377v11.372H0zm12.623 0H24v11.372H12.623zM0 12.623h11.377V24H0zm12.623 0H24V24H12.623z"/>
                </svg>
                <span>Connect Outlook</span>
            </button>
        </div>

        <div id="connected-accounts" class="mt-4 pt-4 border-t hidden">
            <h4 class="text-sm font-medium text-gray-700 mb-2">Connected Accounts</h4>
            <div id="connected-accounts-list" class="space-y-2"></div>
        </div>

        <button onclick="closeEmailConnectModal()" class="mt-4 w-full px-4 py-2 text-gray-600 hover:bg-gray-100 rounded transition-colors">
            Close
        </button>
    </div>
</div>
```

**Step 3: Commit**

```bash
git add app/static/index.html
git commit -m "feat: add email connection UI components"
```

---

## Task 11: Add Email Connection JavaScript

**Files:**
- Modify: `app/static/index.html`

**Step 1: Add email connection JavaScript functions**

Add in <script> section:
```javascript
// ==========================================
// Email OAuth Functions
// ==========================================

// Load email connection status on page load
async function loadEmailStatus() {
    try {
        const response = await fetch('/api/email/status');
        const data = await response.json();
        updateEmailStatusUI(data.accounts);
    } catch (error) {
        console.error('Failed to load email status:', error);
    }
}

// Update UI based on connected accounts
function updateEmailStatusUI(accounts) {
    const statusText = document.getElementById('email-status-text');
    const connectBtn = document.getElementById('connect-email-btn');
    const connectedSection = document.getElementById('connected-accounts');
    const connectedList = document.getElementById('connected-accounts-list');

    if (accounts.length === 0) {
        statusText.textContent = 'Not connected';
        statusText.className = 'text-sm text-gray-500';
        connectBtn.textContent = 'Connect';
    } else {
        const emails = accounts.map(a => a.email).join(', ');
        statusText.textContent = emails;
        statusText.className = 'text-sm text-green-600';
        connectBtn.textContent = 'Manage';

        // Update connected accounts in modal
        connectedSection.classList.remove('hidden');
        connectedList.innerHTML = accounts.map(account => `
            <div class="flex items-center justify-between p-2 bg-gray-50 rounded">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-medium">${account.provider}</span>
                    <span class="text-sm text-gray-600">${account.email}</span>
                </div>
                <button onclick="disconnectEmail('${account.provider}')" class="text-red-600 hover:text-red-800 text-sm">
                    Disconnect
                </button>
            </div>
        `).join('');
    }

    // Store for use in compose modal
    window.connectedEmailAccounts = accounts;
}

// Show email connect modal
function showEmailConnectModal() {
    document.getElementById('email-connect-modal').classList.remove('hidden');
    loadEmailStatus();  // Refresh status
}

// Close email connect modal
function closeEmailConnectModal() {
    document.getElementById('email-connect-modal').classList.add('hidden');
}

// Start OAuth flow for provider
function connectEmail(provider) {
    // Open OAuth in new window/tab
    window.location.href = `/api/email/auth/${provider}`;
}

// Disconnect email account
async function disconnectEmail(provider) {
    if (!confirm(`Disconnect ${provider} account?`)) return;

    try {
        const response = await fetch(`/api/email/disconnect?provider=${provider}`, {
            method: 'POST'
        });

        if (response.ok) {
            showToast(`${provider} disconnected`, 'success');
            loadEmailStatus();
        } else {
            showToast('Failed to disconnect', 'error');
        }
    } catch (error) {
        console.error('Disconnect error:', error);
        showToast('Failed to disconnect', 'error');
    }
}

// Handle OAuth callback parameters on page load
function handleEmailCallbackParams() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('email_connected')) {
        const provider = params.get('email_connected');
        const email = params.get('email');
        showToast(`Connected ${provider}: ${email}`, 'success');
        // Clean up URL
        window.history.replaceState({}, '', window.location.pathname);
        loadEmailStatus();
    }

    if (params.has('email_error')) {
        const error = params.get('email_error');
        showToast(`Email connection failed: ${error}`, 'error');
        window.history.replaceState({}, '', window.location.pathname);
    }
}
```

**Step 2: Add to page initialization**

Find the DOMContentLoaded or page init section and add:
```javascript
// Load email status on page load
loadEmailStatus();
handleEmailCallbackParams();
```

**Step 3: Commit**

```bash
git add app/static/index.html
git commit -m "feat: add email connection JavaScript functions"
```

---

## Task 12: Add Compose Email Modal

**Files:**
- Modify: `app/static/index.html`

**Step 1: Add compose email modal HTML**

Add before closing </body>:
```html
<!-- Compose Email Modal -->
<div id="compose-email-modal" class="hidden fixed inset-0 bg-black/50 flex items-center justify-center z-50">
    <div class="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <h3 class="text-lg font-semibold mb-4">Compose Email</h3>

        <!-- To field - readonly -->
        <div class="mb-3">
            <label class="block text-sm text-gray-600 mb-1">To</label>
            <input id="compose-to" readonly class="w-full border rounded px-3 py-2 bg-gray-50" />
        </div>

        <!-- CC field -->
        <div class="mb-3">
            <label class="block text-sm text-gray-600 mb-1">CC <span class="text-gray-400">(optional)</span></label>
            <input id="compose-cc" class="w-full border rounded px-3 py-2" placeholder="email@example.com, another@example.com" />
        </div>

        <!-- BCC field -->
        <div class="mb-3">
            <label class="block text-sm text-gray-600 mb-1">BCC <span class="text-gray-400">(optional)</span></label>
            <input id="compose-bcc" class="w-full border rounded px-3 py-2" placeholder="email@example.com" />
        </div>

        <!-- Subject -->
        <div class="mb-3">
            <label class="block text-sm text-gray-600 mb-1">Subject</label>
            <input id="compose-subject" class="w-full border rounded px-3 py-2" />
        </div>

        <!-- Template selector (if templates exist) -->
        <div class="mb-3">
            <label class="block text-sm text-gray-600 mb-1">Template <span class="text-gray-400">(optional)</span></label>
            <select id="compose-template" onchange="applyEmailTemplate()" class="w-full border rounded px-3 py-2">
                <option value="">-- No template --</option>
            </select>
        </div>

        <!-- Body -->
        <div class="mb-4">
            <label class="block text-sm text-gray-600 mb-1">Message</label>
            <textarea id="compose-body" rows="10" class="w-full border rounded px-3 py-2 font-mono text-sm"></textarea>
        </div>

        <!-- Actions -->
        <div class="flex justify-between items-center">
            <div class="flex items-center gap-2">
                <label class="text-sm text-gray-600">Send via:</label>
                <select id="compose-provider" class="border rounded px-3 py-2">
                    <!-- Populated dynamically -->
                </select>
            </div>
            <div class="flex gap-2">
                <button onclick="closeComposeModal()" class="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded transition-colors">
                    Cancel
                </button>
                <button id="compose-send-btn" onclick="sendComposedEmail()" class="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">
                    Send
                </button>
            </div>
        </div>
    </div>
</div>
```

**Step 2: Commit**

```bash
git add app/static/index.html
git commit -m "feat: add compose email modal HTML"
```

---

## Task 13: Add Compose Email JavaScript

**Files:**
- Modify: `app/static/index.html`

**Step 1: Add compose modal JavaScript functions**

Add in <script> section:
```javascript
// ==========================================
// Compose Email Functions
// ==========================================

// Current contact being emailed (set when opening modal)
let currentComposeContact = null;

// Open compose modal for a contact
function openComposeModal(contact) {
    currentComposeContact = contact;

    // Populate provider dropdown
    const providerSelect = document.getElementById('compose-provider');
    const accounts = window.connectedEmailAccounts || [];

    if (accounts.length === 0) {
        showToast('No email account connected. Please connect Gmail or Outlook first.', 'error');
        showEmailConnectModal();
        return;
    }

    providerSelect.innerHTML = accounts.map(a =>
        `<option value="${a.provider}">${a.provider} (${a.email})</option>`
    ).join('');

    // Set To field
    document.getElementById('compose-to').value = contact.email || '';

    // Clear other fields
    document.getElementById('compose-cc').value = '';
    document.getElementById('compose-bcc').value = '';
    document.getElementById('compose-subject').value = '';
    document.getElementById('compose-body').value = '';
    document.getElementById('compose-template').value = '';

    // Load templates into dropdown
    loadTemplatesForCompose();

    // Show modal
    document.getElementById('compose-email-modal').classList.remove('hidden');
}

// Close compose modal
function closeComposeModal() {
    document.getElementById('compose-email-modal').classList.add('hidden');
    currentComposeContact = null;
}

// Load templates into compose dropdown
async function loadTemplatesForCompose() {
    try {
        const response = await fetch('/api/templates');
        const templates = await response.json();

        const select = document.getElementById('compose-template');
        select.innerHTML = '<option value="">-- No template --</option>' +
            templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    } catch (error) {
        console.error('Failed to load templates:', error);
    }
}

// Apply selected template to compose fields
async function applyEmailTemplate() {
    const templateId = document.getElementById('compose-template').value;
    if (!templateId) return;

    try {
        const response = await fetch(`/api/templates/${templateId}`);
        const template = await response.json();

        // Replace placeholders with contact data
        let subject = template.subject || '';
        let body = template.body || '';

        if (currentComposeContact) {
            const replacements = {
                '{{first_name}}': currentComposeContact.first_name || '',
                '{{last_name}}': currentComposeContact.last_name || '',
                '{{company}}': currentComposeContact.company_name || '',
                '{{title}}': currentComposeContact.title || ''
            };

            for (const [placeholder, value] of Object.entries(replacements)) {
                subject = subject.split(placeholder).join(value);
                body = body.split(placeholder).join(value);
            }
        }

        document.getElementById('compose-subject').value = subject;
        document.getElementById('compose-body').value = body;
    } catch (error) {
        console.error('Failed to load template:', error);
        showToast('Failed to load template', 'error');
    }
}

// Send the composed email
async function sendComposedEmail() {
    const to = document.getElementById('compose-to').value;
    const cc = document.getElementById('compose-cc').value;
    const bcc = document.getElementById('compose-bcc').value;
    const subject = document.getElementById('compose-subject').value;
    const body = document.getElementById('compose-body').value;
    const provider = document.getElementById('compose-provider').value;

    if (!to) {
        showToast('Recipient email is required', 'error');
        return;
    }

    if (!subject) {
        showToast('Subject is required', 'error');
        return;
    }

    if (!body) {
        showToast('Message body is required', 'error');
        return;
    }

    // Disable send button and show loading state
    const sendBtn = document.getElementById('compose-send-btn');
    const originalText = sendBtn.textContent;
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';

    try {
        const response = await fetch('/api/email/send', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                provider,
                to,
                subject,
                body,
                cc: cc || null,
                bcc: bcc || null
            })
        });

        if (response.ok) {
            showToast('Email sent successfully!', 'success');
            closeComposeModal();
        } else {
            const error = await response.json();
            showToast(`Failed to send: ${error.detail || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        console.error('Send email error:', error);
        showToast('Failed to send email', 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = originalText;
    }
}
```

**Step 2: Commit**

```bash
git add app/static/index.html
git commit -m "feat: add compose email JavaScript functions"
```

---

## Task 14: Update Contact Detail Page Email Button

**Files:**
- Modify: `app/static/index.html`

**Step 1: Find and update email button in contact detail**

Look for the existing email button in the contact detail section (where contact info is shown). Replace the mailto: link with a call to openComposeModal.

Change from something like:
```html
<a href="mailto:${contact.email}" class="...">Email</a>
```

To:
```html
<button onclick="openComposeModal(currentContact)" class="...">Email</button>
```

Or add a new "Send Email" button that uses the new compose modal while keeping the old mailto link as a fallback.

**Step 2: Store current contact reference**

Ensure there's a `currentContact` variable that stores the currently viewed contact when the detail panel is opened.

**Step 3: Commit**

```bash
git add app/static/index.html
git commit -m "feat: update contact detail email button to use compose modal"
```

---

## Task 15: Add Toast Notification System (if not exists)

**Files:**
- Modify: `app/static/index.html`

**Step 1: Check if showToast function exists**

Search for existing showToast function. If it doesn't exist, add it.

**Step 2: Add toast HTML container**

Add before closing </body>:
```html
<!-- Toast Notifications -->
<div id="toast-container" class="fixed bottom-4 right-4 z-50 flex flex-col gap-2"></div>
```

**Step 3: Add toast JavaScript function**

```javascript
// Show toast notification
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');

    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        info: 'bg-blue-500',
        warning: 'bg-yellow-500'
    };

    const toast = document.createElement('div');
    toast.className = `${colors[type] || colors.info} text-white px-4 py-2 rounded shadow-lg transform transition-all duration-300 translate-x-full`;
    toast.textContent = message;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.classList.remove('translate-x-full');
    });

    // Remove after 3 seconds
    setTimeout(() => {
        toast.classList.add('translate-x-full');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
```

**Step 4: Commit**

```bash
git add app/static/index.html
git commit -m "feat: add toast notification system"
```

---

## Task 16: Update README with Email Setup Instructions

**Files:**
- Modify: `README.md`

**Step 1: Add Email Integration section**

Add after the existing Features or Usage section:
```markdown
## Email Integration (Optional)

Kanbun can send emails directly via Gmail or Outlook using OAuth. This requires setting up OAuth credentials with Google and/or Microsoft.

### Quick Setup

1. Generate an encryption key:
   ```bash
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

2. Add to your `.env`:
   ```bash
   EMAIL_ENCRYPTION_KEY=your-generated-key
   ```

3. Follow the provider-specific setup below.

### Gmail Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the Gmail API:
   - APIs & Services → Library → Search "Gmail API" → Enable
4. Create OAuth credentials:
   - APIs & Services → Credentials → Create Credentials → OAuth client ID
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:8000/api/email/callback/gmail`
5. Add to `.env`:
   ```bash
   GMAIL_CLIENT_ID=your-client-id
   GMAIL_CLIENT_SECRET=your-client-secret
   ```

### Outlook Setup

1. Go to [Azure Portal](https://portal.azure.com/) → App registrations
2. New registration:
   - Name: "Kanbun" (or any name)
   - Supported account types: Personal Microsoft accounts only (or your preference)
   - Redirect URI: Web → `http://localhost:8000/api/email/callback/outlook`
3. Add client secret:
   - Certificates & secrets → New client secret
4. Add API permissions:
   - API permissions → Add permission → Microsoft Graph → Delegated permissions → Mail.Send
5. Add to `.env`:
   ```bash
   OUTLOOK_CLIENT_ID=your-application-client-id
   OUTLOOK_CLIENT_SECRET=your-client-secret-value
   ```

### Using Email

1. Click "Connect" next to "Email:" in the header
2. Choose Gmail or Outlook and authorize Kanbun
3. Open any contact and click "Email" to compose and send
```

**Step 2: Update Features list**

Add to Features section:
```markdown
- **Direct Email Sending**: Send emails via Gmail or Outlook OAuth without leaving the app
```

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add email OAuth setup instructions"
```

---

## Task 17: Test End-to-End Flow

**Step 1: Start the server**

Run: `uvicorn app.main:app --reload`

**Step 2: Verify endpoints exist**

Run: `curl http://127.0.0.1:8000/api/email/status`
Expected: `{"accounts": []}`

**Step 3: Test UI loads**

Open browser to http://localhost:8000
Verify "Email: Not connected" appears
Click "Connect" and verify modal appears

**Step 4: Note for full testing**

Full OAuth testing requires:
- Setting up Google Cloud project with Gmail API
- Setting up Azure app registration
- Adding credentials to .env

This can be done manually after implementation.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address any issues found during testing"
```

---

## Summary

This plan implements OAuth email sending with:
- Gmail and Outlook providers
- Encrypted token storage
- In-app compose modal with CC/BCC
- Template integration
- Toast notifications for feedback

Total tasks: 17
Estimated commits: 17-20
