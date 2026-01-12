# app/services/screenshot_service.py
"""
Playwright-based service for capturing screenshots and extracting page content.
"""
import asyncio
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeout


# Use /data/screenshots in Docker, otherwise data/screenshots locally
SCREENSHOTS_DIR = Path(os.environ.get("SCREENSHOTS_DIR", "data/screenshots"))


@dataclass
class EnrichmentResult:
    """Result from enriching a company website."""
    screenshot_path: Optional[str] = None
    extracted_text: Optional[str] = None
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    error: Optional[str] = None


async def enrich_company_website(
    url: str,
    company_id: str,
    width: int = 1280,
    height: int = 800,
    timeout: int = 15000
) -> EnrichmentResult:
    """
    Visit a company website to capture screenshot and extract text content.

    Single browser visit produces both outputs.
    """
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    screenshot_path = SCREENSHOTS_DIR / f"{company_id}.png"
    result = EnrichmentResult()

    try:
        async with async_playwright() as p:
            browser = await p.firefox.launch(headless=True)

            context = await browser.new_context(
                viewport={"width": width, "height": height},
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0"
            )

            page = await context.new_page()

            try:
                await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
                await page.wait_for_timeout(1000)

                # Take screenshot
                await page.screenshot(path=str(screenshot_path), type="png")
                result.screenshot_path = str(screenshot_path)

                # Extract meta tags
                result.meta_title = await page.title()
                result.meta_description = await page.evaluate("""
                    () => {
                        const meta = document.querySelector('meta[name="description"]') ||
                                     document.querySelector('meta[property="og:description"]');
                        return meta ? meta.getAttribute('content') : null;
                    }
                """)

                # Extract visible text content
                result.extracted_text = await page.evaluate("""
                    () => {
                        // Get headings
                        const headings = Array.from(document.querySelectorAll('h1, h2'))
                            .map(h => h.innerText.trim())
                            .filter(t => t.length > 0)
                            .slice(0, 5);

                        // Get paragraphs (skip very short ones, likely navigation)
                        const paragraphs = Array.from(document.querySelectorAll('p'))
                            .map(p => p.innerText.trim())
                            .filter(t => t.length > 30)
                            .slice(0, 10);

                        // Combine
                        const content = [...headings, ...paragraphs].join('\\n\\n');

                        // Limit to ~2000 chars
                        return content.slice(0, 2000);
                    }
                """)

                await browser.close()
                return result

            except PlaywrightTimeout:
                print(f"[WARN] Timeout for {url}")
                result.error = "Page load timeout"
                await browser.close()
                return result

    except Exception as e:
        print(f"[ERROR] Enrichment failed for {url}: {e}")
        result.error = str(e)
        return result


async def capture_screenshot(
    url: str,
    company_id: str,
    width: int = 1280,
    height: int = 800,
    timeout: int = 15000
) -> Optional[str]:
    """
    Capture a screenshot of a website (legacy function for compatibility).
    """
    result = await enrich_company_website(url, company_id, width, height, timeout)
    return result.screenshot_path


def get_screenshot_path(company_id: str) -> Optional[Path]:
    """Get the path to a company's screenshot if it exists."""
    path = SCREENSHOTS_DIR / f"{company_id}.png"
    if path.exists():
        return path
    return None


def screenshot_exists(company_id: str) -> bool:
    """Check if a screenshot exists for a company."""
    return (SCREENSHOTS_DIR / f"{company_id}.png").exists()
