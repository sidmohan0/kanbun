"""
Outlook OAuth provider implementation.

This module provides Outlook OAuth authentication and email sending using
Microsoft MSAL for OAuth flow and Microsoft Graph API for email access.

Setup Instructions:
-------------------
1. Go to Azure Portal (https://portal.azure.com)
2. Navigate to "Azure Active Directory" > "App registrations"
3. Click "New registration":
   - Name: Your app name (e.g., "Kanbun Email")
   - Supported account types: Select "Accounts in any organizational directory
     and personal Microsoft accounts" for broadest compatibility
   - Redirect URI: Select "Web" and enter http://localhost:8000/api/email/callback/outlook
4. After registration, note the "Application (client) ID" - this is your OUTLOOK_CLIENT_ID
5. Create a client secret:
   - Go to "Certificates & secrets" > "Client secrets"
   - Click "New client secret"
   - Set an expiration and add
   - Copy the secret Value (not ID) - this is your OUTLOOK_CLIENT_SECRET
6. Configure API permissions:
   - Go to "API permissions" > "Add a permission"
   - Select "Microsoft Graph" > "Delegated permissions"
   - Add: Mail.Send, User.Read
   - Click "Grant admin consent" if required by your organization
7. Add to your .env file:
   OUTLOOK_CLIENT_ID=your_client_id
   OUTLOOK_CLIENT_SECRET=your_client_secret
   OUTLOOK_REDIRECT_URI=http://localhost:8000/api/email/callback/outlook

Note: For production, update the redirect URI to your production domain
and update it in the Azure Portal app registration.
"""

import time
from typing import Optional

import aiosqlite
import httpx
import msal

from app.config import settings
from .base import EmailProvider


# Microsoft OAuth authority (common supports both personal and work accounts)
AUTHORITY = "https://login.microsoftonline.com/common"

# Microsoft Graph API scopes for sending email and reading user profile
OUTLOOK_SCOPES = [
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/User.Read",
]

# Microsoft Graph API base URL
GRAPH_API_URL = "https://graph.microsoft.com/v1.0"


class OutlookProvider(EmailProvider):
    """
    Outlook OAuth provider for email sending.

    Uses Microsoft MSAL for OAuth 2.0 authentication and Microsoft Graph API
    for sending emails. Tokens are encrypted and stored in the database for reuse.

    Supports both personal Microsoft accounts (outlook.com, hotmail.com) and
    organizational accounts (Office 365).
    """

    @property
    def provider_name(self) -> str:
        """Return provider name."""
        return "outlook"

    def _get_msal_app(self) -> msal.ConfidentialClientApplication:
        """
        Create MSAL ConfidentialClientApplication instance.

        Returns:
            Configured MSAL application for OAuth operations
        """
        return msal.ConfidentialClientApplication(
            client_id=settings.outlook_client_id,
            client_credential=settings.outlook_client_secret,
            authority=AUTHORITY,
        )

    def get_auth_url(self, state: Optional[str] = None) -> str:
        """
        Generate OAuth authorization URL for Outlook.

        Uses MSAL to build the authorization URL. The user will be redirected
        to Microsoft's login page to authenticate and consent to the requested
        permissions.

        Args:
            state: Optional state parameter for CSRF protection

        Returns:
            Authorization URL to redirect the user to
        """
        if not settings.outlook_client_id or not settings.outlook_client_secret:
            raise ValueError(
                "Outlook OAuth not configured. Set OUTLOOK_CLIENT_ID and "
                "OUTLOOK_CLIENT_SECRET in your .env file."
            )

        app = self._get_msal_app()

        auth_url = app.get_authorization_request_url(
            scopes=OUTLOOK_SCOPES,
            redirect_uri=settings.outlook_redirect_uri,
            state=state,
        )

        return auth_url

    async def handle_callback(
        self,
        db: aiosqlite.Connection,
        code: str
    ) -> dict:
        """
        Handle OAuth callback from Microsoft.

        Exchanges the authorization code for tokens using MSAL, retrieves the
        user's email address from Microsoft Graph API, and stores the encrypted
        tokens in the database.

        Args:
            db: Database connection
            code: Authorization code from OAuth callback

        Returns:
            Dict with email address of connected account
        """
        app = self._get_msal_app()

        # Exchange authorization code for tokens
        result = app.acquire_token_by_authorization_code(
            code=code,
            scopes=OUTLOOK_SCOPES,
            redirect_uri=settings.outlook_redirect_uri,
        )

        if "error" in result:
            raise ValueError(
                f"Failed to acquire token: {result.get('error_description', result.get('error'))}"
            )

        access_token = result["access_token"]
        refresh_token = result.get("refresh_token", "")

        # Calculate token expiry (expires_in is in seconds)
        expires_in = result.get("expires_in", 3600)
        expires_at = int(time.time()) + expires_in

        # Get user email from Microsoft Graph API
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{GRAPH_API_URL}/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            user_data = response.json()

        # Microsoft Graph returns email in 'mail' or 'userPrincipalName'
        email = user_data.get("mail") or user_data.get("userPrincipalName")
        if not email:
            raise ValueError("Could not retrieve email address from Microsoft account")

        # Store encrypted tokens
        await self.token_store.save_tokens(
            db=db,
            provider=self.provider_name,
            email=email,
            refresh_token=refresh_token,
            access_token=access_token,
            expires_at=expires_at,
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
        Send an email via Microsoft Graph API.

        Constructs the sendMail request payload and sends it to the
        Graph API endpoint. The email is saved to Sent Items by default.

        Args:
            db: Database connection
            to: Recipient email address
            subject: Email subject
            body: Email body (plain text)
            cc: Optional CC recipients (comma-separated)
            bcc: Optional BCC recipients (comma-separated)

        Returns:
            Dict with success status (Graph API doesn't return message ID for sendMail)
        """
        access_token = await self.get_valid_access_token(db)

        # Build recipients list
        def parse_recipients(addresses: Optional[str]) -> list:
            """Parse comma-separated email addresses into Graph API format."""
            if not addresses:
                return []
            return [
                {"emailAddress": {"address": addr.strip()}}
                for addr in addresses.split(",")
                if addr.strip()
            ]

        # Build the sendMail payload
        payload = {
            "message": {
                "subject": subject,
                "body": {
                    "contentType": "Text",
                    "content": body,
                },
                "toRecipients": parse_recipients(to),
                "ccRecipients": parse_recipients(cc),
                "bccRecipients": parse_recipients(bcc),
            },
            "saveToSentItems": True,
        }

        # Send via Graph API
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{GRAPH_API_URL}/me/sendMail",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )

            if response.status_code == 401:
                # Token might be expired, try refreshing
                access_token = await self.refresh_access_token(db)
                response = await client.post(
                    f"{GRAPH_API_URL}/me/sendMail",
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "application/json",
                    },
                    json=payload,
                )

            if response.status_code != 202:
                error_data = response.json() if response.content else {}
                error_msg = error_data.get("error", {}).get("message", response.text)
                raise ValueError(f"Failed to send email: {error_msg}")

        # Graph API sendMail returns 202 Accepted with no body on success
        return {"status": "sent"}

    async def refresh_access_token(self, db: aiosqlite.Connection) -> str:
        """
        Refresh the Outlook access token using stored refresh token.

        Uses MSAL to refresh the token, then stores the new tokens
        in the database.

        Args:
            db: Database connection

        Returns:
            New access token
        """
        tokens = await self.token_store.get_tokens(db, self.provider_name)
        if not tokens:
            raise ValueError("No Outlook account connected")

        if not tokens["refresh_token"]:
            raise ValueError(
                "No refresh token available. Please reconnect your Outlook account."
            )

        app = self._get_msal_app()

        # Use MSAL to refresh the token
        result = app.acquire_token_by_refresh_token(
            refresh_token=tokens["refresh_token"],
            scopes=OUTLOOK_SCOPES,
        )

        if "error" in result:
            raise ValueError(
                f"Failed to refresh token: {result.get('error_description', result.get('error'))}"
            )

        new_access_token = result["access_token"]
        new_refresh_token = result.get("refresh_token", tokens["refresh_token"])

        # Calculate new expiry
        expires_in = result.get("expires_in", 3600)
        expires_at = int(time.time()) + expires_in

        # Update stored tokens
        # Note: Microsoft may return a new refresh token, so we save both
        await self.token_store.save_tokens(
            db=db,
            provider=self.provider_name,
            email=tokens["email"],
            refresh_token=new_refresh_token,
            access_token=new_access_token,
            expires_at=expires_at,
        )

        return new_access_token
