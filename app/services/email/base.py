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
        """Generate OAuth authorization URL."""
        pass

    @abstractmethod
    async def handle_callback(
        self,
        db: aiosqlite.Connection,
        code: str
    ) -> dict:
        """Handle OAuth callback - exchange code for tokens."""
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
        """Send an email."""
        pass

    @abstractmethod
    async def refresh_access_token(self, db: aiosqlite.Connection) -> str:
        """Refresh the access token using stored refresh token."""
        pass

    async def get_valid_access_token(self, db: aiosqlite.Connection) -> str:
        """Get a valid access token, refreshing if expired."""
        tokens = await self.token_store.get_tokens(db, self.provider_name)
        if not tokens:
            raise ValueError(f"No {self.provider_name} account connected")

        if self.token_store.is_token_expired(tokens["expires_at"]):
            return await self.refresh_access_token(db)

        return tokens["access_token"]
