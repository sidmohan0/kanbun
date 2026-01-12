#!/usr/bin/env python3
"""
Refresh LinkedIn cookie by opening a browser for manual login.
Extracts the li_at cookie and updates the environment.
"""
import subprocess
import sys
import os
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT))


def check_playwright():
    """Ensure playwright is installed."""
    try:
        import playwright
        return True
    except ImportError:
        print("Installing playwright...")
        subprocess.run([sys.executable, "-m", "pip", "install", "playwright"], check=True)
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
        return True


def get_linkedin_cookie():
    """Open browser and get li_at cookie."""
    from playwright.sync_api import sync_playwright
    import time

    print("\n=== LinkedIn Cookie Refresh ===\n")
    print("A browser will open to LinkedIn.")
    print("If you're not logged in, please log in manually.")
    print("The script will automatically detect when you're logged in.\n")

    with sync_playwright() as p:
        # Use persistent context to remember login across runs
        user_data_dir = PROJECT_ROOT / "data" / "browser_profile"
        user_data_dir.mkdir(parents=True, exist_ok=True)

        browser = p.chromium.launch_persistent_context(
            str(user_data_dir),
            headless=False,
            viewport={"width": 1280, "height": 800}
        )

        page = browser.pages[0] if browser.pages else browser.new_page()
        page.goto("https://www.linkedin.com/feed/")

        # Wait for login - check for feed content or profile elements
        print("Waiting for login...")
        max_wait = 120  # 2 minutes max
        waited = 0
        li_at = None

        while waited < max_wait:
            cookies = browser.cookies()
            for cookie in cookies:
                if cookie["name"] == "li_at" and len(cookie["value"]) > 50:
                    li_at = cookie["value"]
                    break

            if li_at:
                # Verify we're actually on the feed (logged in)
                try:
                    if page.url.startswith("https://www.linkedin.com/feed") or \
                       page.query_selector("[data-control-name='identity_welcome_message']") or \
                       page.query_selector(".feed-identity-module"):
                        print("Login detected!")
                        break
                except:
                    pass

            time.sleep(2)
            waited += 2
            if waited % 10 == 0:
                print(f"  Still waiting... ({waited}s)")

        # Capture all LinkedIn cookies for the scraper
        all_cookies = [c for c in browser.cookies() if "linkedin.com" in c.get("domain", "")]

        # Save cookies to a JSON file for the scraper
        import json
        cookies_file = PROJECT_ROOT / "data" / "linkedin_cookies.json"
        cookies_file.parent.mkdir(parents=True, exist_ok=True)
        cookies_file.write_text(json.dumps(all_cookies, indent=2))
        print(f"Saved {len(all_cookies)} cookies to {cookies_file}")

        browser.close()

        return li_at


def update_env_file(cookie: str):
    """Update .env file with new cookie."""
    env_path = PROJECT_ROOT / ".env"

    if env_path.exists():
        content = env_path.read_text()
        lines = content.split("\n")
        new_lines = []
        found = False
        for line in lines:
            if line.startswith("LINKEDIN_LI_AT="):
                new_lines.append(f"LINKEDIN_LI_AT={cookie}")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"LINKEDIN_LI_AT={cookie}")
        env_path.write_text("\n".join(new_lines))
    else:
        env_path.write_text(f"LINKEDIN_LI_AT={cookie}\n")

    print(f"Updated {env_path}")


def restart_mcp_server(cookie: str):
    """Restart the LinkedIn MCP Docker container with new cookie."""
    print("\nRestarting LinkedIn MCP server...")

    # Stop existing container
    subprocess.run(["docker", "stop", "linkedin-mcp"], capture_output=True)
    subprocess.run(["docker", "rm", "linkedin-mcp"], capture_output=True)

    # Start new container - note: env var is LINKEDIN_COOKIE not LINKEDIN_LI_AT
    result = subprocess.run([
        "docker", "run", "-d",
        "--name", "linkedin-mcp",
        "-p", "3000:3000",
        "-e", f"LINKEDIN_COOKIE={cookie}",
        "stickerdaniel/linkedin-mcp-server:latest",
        "--transport", "streamable-http",
        "--port", "3000"
    ], capture_output=True, text=True)

    if result.returncode == 0:
        print("LinkedIn MCP server restarted successfully!")
        return True
    else:
        print(f"Failed to start container: {result.stderr}")
        return False


def main():
    check_playwright()

    cookie = get_linkedin_cookie()

    if not cookie:
        print("\nError: Could not find li_at cookie.")
        print("Make sure you're fully logged into LinkedIn.")
        sys.exit(1)

    print(f"\nFound cookie: {cookie[:20]}...{cookie[-10:]}")

    update_env_file(cookie)
    restart_mcp_server(cookie)

    print("\n=== Done! ===")
    print("You can now use the Lead Enrichment app.")


if __name__ == "__main__":
    main()
