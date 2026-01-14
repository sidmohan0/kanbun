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
