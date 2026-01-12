# app/services/linkedin_scraper.py
"""
LinkedIn scraper using Playwright with sync API.
Uses persistent browser profile shared with cookie refresh script.
"""
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any


# Thread pool for running sync playwright in async context
_executor = ThreadPoolExecutor(max_workers=1)


class LinkedInScraper:
    def __init__(self):
        self.context = None
        self.project_root = Path(__file__).parent.parent.parent
        self._playwright = None

    def _ensure_browser(self):
        """Initialize browser using Chrome profile for persistent login."""
        if self.context:
            return

        from playwright.sync_api import sync_playwright
        import os

        self._playwright = sync_playwright().start()

        # Try to use user's Chrome profile (has existing LinkedIn login)
        # Fall back to Playwright profile if Chrome is running
        chrome_profile = os.path.expanduser("~/Library/Application Support/Google/Chrome")
        playwright_profile = self.project_root / "data" / "browser_profile"
        playwright_profile.mkdir(parents=True, exist_ok=True)

        try:
            # Try Chrome profile first (user's logged-in session)
            self.context = self._playwright.chromium.launch_persistent_context(
                chrome_profile,
                channel="chrome",  # Use installed Chrome
                headless=False,
                viewport={"width": 1280, "height": 800},
            )
            print("[INFO] Using Chrome profile with existing login")
        except Exception as e:
            print(f"[INFO] Chrome profile busy, using Playwright profile: {e}")
            # Fall back to Playwright profile
            self.context = self._playwright.chromium.launch_persistent_context(
                str(playwright_profile),
                headless=False,
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )

    def get_company_profile_sync(self, linkedin_url: str) -> dict[str, Any]:
        """Scrape company profile from LinkedIn (sync version)."""
        self._ensure_browser()

        page = self.context.new_page()

        try:
            page.goto(linkedin_url, wait_until="domcontentloaded", timeout=30000)
            time.sleep(3)

            if "/login" in page.url or "/authwall" in page.url:
                return {"error": "Login required - run refresh_linkedin_cookie.py"}

            result = {
                "name": None,
                "description": None,
                "website": None,
                "industry": None,
            }

            # Get company name
            try:
                name_el = page.query_selector("h1")
                if name_el:
                    result["name"] = name_el.inner_text().strip()
            except:
                pass

            # Get description
            try:
                for selector in ["p.break-words", ".org-top-card-summary__tagline", ".org-page-details__definition-text"]:
                    desc_el = page.query_selector(selector)
                    if desc_el:
                        text = desc_el.inner_text().strip()
                        print(f"[DEBUG] Selector '{selector}' found text: {text[:100] if text else 'empty'}...")
                        if text and len(text) > 20:
                            result["description"] = text
                            break
            except Exception as e:
                print(f"[DEBUG] Description error: {e}")

            # Get website
            try:
                links = page.query_selector_all("a[href]")
                for link in links:
                    href = link.get_attribute("href")
                    if href and "linkedin.com" not in href and href.startswith("http"):
                        text = link.inner_text()
                        if any(x in text.lower() for x in ["visit", "website", "site"]) or \
                           any(x in href for x in [".com", ".io", ".ai", ".co"]):
                            result["website"] = href
                            break
            except:
                pass

            return result

        except Exception as e:
            return {"error": str(e)}
        finally:
            page.close()

    def close(self):
        """Close browser."""
        if self.context:
            self.context.close()
            self.context = None
        if self._playwright:
            self._playwright.stop()
            self._playwright = None


# Global scraper instance (reused across requests)
_scraper = None


def _get_scraper():
    global _scraper
    if _scraper is None:
        _scraper = LinkedInScraper()
    return _scraper


def _scrape_company(linkedin_url: str) -> dict[str, Any]:
    """Sync function to scrape company."""
    return _get_scraper().get_company_profile_sync(linkedin_url)


def _close_scraper():
    """Close the global scraper."""
    global _scraper
    if _scraper:
        _scraper.close()
        _scraper = None


class LinkedInClient:
    """Async wrapper for sync LinkedIn scraper."""

    def __init__(self, server_url: str = None):
        pass  # server_url ignored

    async def get_company_profile(self, linkedin_url: str) -> dict[str, Any]:
        """Get company profile (async wrapper)."""
        import asyncio
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(_executor, _scrape_company, linkedin_url)

    async def close_session(self):
        """Close browser session."""
        import asyncio
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(_executor, _close_scraper)
