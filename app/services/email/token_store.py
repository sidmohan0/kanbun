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
        if settings.email_encryption_key:
            self._cipher = Fernet(settings.email_encryption_key.encode())
        else:
            self._cipher = None

    def _encrypt(self, plaintext: str) -> str:
        """Encrypt a string using Fernet."""
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
        """Save or update OAuth tokens for a provider."""
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
        """Retrieve decrypted tokens for a provider."""
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
        """Get list of connected accounts (without tokens)."""
        async with db.execute(
            "SELECT provider, email FROM email_accounts"
        ) as cursor:
            rows = await cursor.fetchall()
        return [{"provider": row[0], "email": row[1]} for row in rows]

    def is_token_expired(self, expires_at: int, buffer_seconds: int = 300) -> bool:
        """Check if token is expired (with 5 minute buffer by default)."""
        return time.time() > (expires_at - buffer_seconds)
