# app/services/screenshot_service.py
"""
Playwright-based screenshot service for capturing company website screenshots.
"""
import asyncio
import os
from pathlib import Path
from typing import Optional
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout


# Use /data/screenshots in Docker, otherwise data/screenshots locally
SCREENSHOTS_DIR = Path(os.environ.get("SCREENSHOTS_DIR", "data/screenshots"))


async def capture_screenshot(
    url: str,
    company_id: str,
    width: int = 1280,
    height: int = 800,
    timeout: int = 15000
) -> Optional[str]:
    """
    Capture a screenshot of a website.

    Returns the path to the saved screenshot, or None if failed.
    """
    # Ensure screenshots directory exists
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    screenshot_path = SCREENSHOTS_DIR / f"{company_id}.png"

    try:
        async with async_playwright() as p:
            browser = await p.firefox.launch(headless=True)

            context = await browser.new_context(
                viewport={"width": width, "height": height},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0"
            )

            page = await context.new_page()

            try:
                # Navigate to the URL
                await page.goto(url, wait_until="domcontentloaded", timeout=timeout)

                # Wait a bit for any animations/lazy loading
                await page.wait_for_timeout(1000)

                # Take screenshot
                await page.screenshot(path=str(screenshot_path), type="png")

                await browser.close()
                return str(screenshot_path)

            except PlaywrightTimeout:
                print(f"[WARN] Screenshot timeout for {url}")
                await browser.close()
                return None

    except Exception as e:
        print(f"[ERROR] Screenshot failed for {url}: {e}")
        return None


def get_screenshot_path(company_id: str) -> Optional[Path]:
    """Get the path to a company's screenshot if it exists."""
    path = SCREENSHOTS_DIR / f"{company_id}.png"
    if path.exists():
        return path
    return None


def screenshot_exists(company_id: str) -> bool:
    """Check if a screenshot exists for a company."""
    return (SCREENSHOTS_DIR / f"{company_id}.png").exists()
