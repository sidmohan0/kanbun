"""
Gmail OAuth provider implementation.

This module provides Gmail OAuth authentication and email sending using
the Google APIs. Uses google-auth-oauthlib for OAuth flow and
google-api-python-client for Gmail API access.

Setup Instructions:
-------------------
1. Go to Google Cloud Console (https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable the Gmail API:
   - Go to "APIs & Services" > "Library"
   - Search for "Gmail API" and enable it
4. Configure OAuth consent screen:
   - Go to "APIs & Services" > "OAuth consent screen"
   - Choose "External" user type
   - Fill in required app information
   - Add scope: "https://www.googleapis.com/auth/gmail.send"
5. Create OAuth credentials:
   - Go to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application"
   - Add authorized redirect URI: http://localhost:8000/api/email/callback/gmail
   - Copy the Client ID and Client Secret
6. Add to your .env file:
   GMAIL_CLIENT_ID=your_client_id
   GMAIL_CLIENT_SECRET=your_client_secret
   GMAIL_REDIRECT_URI=http://localhost:8000/api/email/callback/gmail

Note: For production, update the redirect URI to your production domain
and add it to the authorized redirect URIs in Google Cloud Console.
"""

import base64
import time
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional

import aiosqlite
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

from app.config import settings
from .base import EmailProvider


# Gmail API scopes - send emails and read user's email address
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly"  # Needed to get user's email via getProfile
]


class GmailProvider(EmailProvider):
    """
    Gmail OAuth provider for email sending.

    Uses Google OAuth 2.0 for authentication and Gmail API for sending.
    Tokens are encrypted and stored in the database for reuse.
    """

    @property
    def provider_name(self) -> str:
        """Return provider name."""
        return "gmail"

    def _get_client_config(self) -> dict:
        """
        Build OAuth client configuration from settings.

        Returns the client config in the format expected by google-auth-oauthlib.
        """
        return {
            "web": {
                "client_id": settings.gmail_client_id,
                "client_secret": settings.gmail_client_secret,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.gmail_redirect_uri],
            }
        }

    def get_auth_url(self, state: Optional[str] = None) -> str:
        """
        Generate OAuth authorization URL for Gmail.

        Uses access_type="offline" to get a refresh token and
        prompt="consent" to ensure we always get a refresh token,
        even for returning users.

        Args:
            state: Optional state parameter for CSRF protection

        Returns:
            Authorization URL to redirect the user to
        """
        if not settings.gmail_client_id or not settings.gmail_client_secret:
            raise ValueError(
                "Gmail OAuth not configured. Set GMAIL_CLIENT_ID and "
                "GMAIL_CLIENT_SECRET in your .env file."
            )

        flow = Flow.from_client_config(
            self._get_client_config(),
            scopes=GMAIL_SCOPES,
            redirect_uri=settings.gmail_redirect_uri
        )

        auth_url, _ = flow.authorization_url(
            access_type="offline",  # Request refresh token
            prompt="consent",       # Always show consent to ensure refresh token
            include_granted_scopes="true",
            state=state
        )

        return auth_url

    async def handle_callback(
        self,
        db: aiosqlite.Connection,
        code: str
    ) -> dict:
        """
        Handle OAuth callback from Google.

        Exchanges the authorization code for tokens, retrieves the user's
        email address, and stores the encrypted tokens in the database.

        Args:
            db: Database connection
            code: Authorization code from OAuth callback

        Returns:
            Dict with email address of connected account
        """
        flow = Flow.from_client_config(
            self._get_client_config(),
            scopes=GMAIL_SCOPES,
            redirect_uri=settings.gmail_redirect_uri
        )

        # Exchange code for tokens
        flow.fetch_token(code=code)
        credentials = flow.credentials

        # Get user's email address using Gmail API
        service = build("gmail", "v1", credentials=credentials)
        profile = service.users().getProfile(userId="me").execute()
        email = profile["emailAddress"]

        # Calculate token expiry timestamp
        expires_at = int(time.time()) + 3600  # Default 1 hour expiry
        if credentials.expiry:
            expires_at = int(credentials.expiry.timestamp())

        # Store encrypted tokens
        await self.token_store.save_tokens(
            db=db,
            provider=self.provider_name,
            email=email,
            refresh_token=credentials.refresh_token or "",
            access_token=credentials.token,
            expires_at=expires_at
        )

        return {"email": email}

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
        Send an email via Gmail API.

        Builds a MIME message, base64 encodes it, and sends via the
        Gmail API users().messages().send() endpoint.

        Args:
            db: Database connection
            to: Recipient email address
            subject: Email subject
            body: Email body (plain text)
            cc: Optional CC recipients
            bcc: Optional BCC recipients

        Returns:
            Dict with message_id of sent email
        """
        access_token = await self.get_valid_access_token(db)
        tokens = await self.token_store.get_tokens(db, self.provider_name)

        if not tokens:
            raise ValueError("No Gmail account connected")

        sender_email = tokens["email"]

        # Build MIME message
        message = MIMEMultipart()
        message["to"] = to
        message["from"] = sender_email
        message["subject"] = subject

        if cc:
            message["cc"] = cc
        if bcc:
            message["bcc"] = bcc

        # Add plain text body
        message.attach(MIMEText(body, "plain"))

        # Encode message for Gmail API
        raw_message = base64.urlsafe_b64encode(
            message.as_bytes()
        ).decode("utf-8")

        # Build credentials and send
        credentials = Credentials(
            token=access_token,
            refresh_token=tokens["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.gmail_client_id,
            client_secret=settings.gmail_client_secret,
            scopes=GMAIL_SCOPES
        )

        try:
            service = build("gmail", "v1", credentials=credentials)
            result = service.users().messages().send(
                userId="me",
                body={"raw": raw_message}
            ).execute()

            return {"message_id": result["id"]}

        except HttpError as e:
            raise ValueError(f"Failed to send email: {e.reason}")

    async def refresh_access_token(self, db: aiosqlite.Connection) -> str:
        """
        Refresh the Gmail access token using stored refresh token.

        Uses google.oauth2.credentials.Credentials to automatically
        refresh the token, then stores the new access token.

        Args:
            db: Database connection

        Returns:
            New access token
        """
        tokens = await self.token_store.get_tokens(db, self.provider_name)
        if not tokens:
            raise ValueError("No Gmail account connected")

        if not tokens["refresh_token"]:
            raise ValueError(
                "No refresh token available. Please reconnect your Gmail account."
            )

        # Create credentials with refresh token
        credentials = Credentials(
            token=tokens["access_token"],
            refresh_token=tokens["refresh_token"],
            token_uri="https://oauth2.googleapis.com/token",
            client_id=settings.gmail_client_id,
            client_secret=settings.gmail_client_secret,
            scopes=GMAIL_SCOPES
        )

        # Refresh the credentials
        from google.auth.transport.requests import Request
        credentials.refresh(Request())

        # Calculate new expiry
        expires_at = int(time.time()) + 3600
        if credentials.expiry:
            expires_at = int(credentials.expiry.timestamp())

        # Update stored token
        await self.token_store.update_access_token(
            db=db,
            provider=self.provider_name,
            access_token=credentials.token,
            expires_at=expires_at
        )

        return credentials.token
