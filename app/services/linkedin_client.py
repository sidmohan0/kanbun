# app/services/linkedin_client.py
import httpx
import json
import uuid
from typing import Any, Optional


class LinkedInMCPClient:
    def __init__(self, server_url: str):
        self.server_url = server_url.rstrip("/")
        self.session_id = None
        self._client = None

    async def _ensure_session(self) -> None:
        """Initialize MCP session if not already done."""
        if self.session_id:
            return

        payload = {
            "jsonrpc": "2.0",
            "id": str(uuid.uuid4()),
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "kanbun", "version": "1.0"}
            }
        }

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream"
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.server_url}/mcp",
                json=payload,
                headers=headers,
                timeout=30.0
            )
            self.session_id = response.headers.get("mcp-session-id")
            if not self.session_id:
                raise Exception("Failed to get MCP session ID")

    async def _call_jsonrpc(self, method: str, params: dict[str, Any] = None) -> Any:
        """Call the MCP server using JSON-RPC over HTTP with SSE."""
        await self._ensure_session()

        request_id = str(uuid.uuid4())

        payload = {
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params or {}
        }

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "mcp-session-id": self.session_id
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.server_url}/mcp",
                json=payload,
                headers=headers,
                timeout=120.0
            )

            # Parse SSE response
            result = None
            for line in response.text.split("\n"):
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    if "result" in data:
                        result = data["result"]
                    elif "error" in data:
                        raise Exception(f"MCP Error: {data['error']}")

            return result

    async def _call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        """Call a tool on the MCP server."""
        result = await self._call_jsonrpc("tools/call", {
            "name": tool_name,
            "arguments": arguments
        })

        # Extract content from MCP response
        if result and "content" in result:
            for item in result["content"]:
                if item.get("type") == "text":
                    try:
                        return json.loads(item["text"])
                    except json.JSONDecodeError:
                        return {"raw_text": item["text"]}

        return result or {}

    def _extract_company_slug(self, linkedin_url: str) -> str:
        """Extract company slug from LinkedIn URL."""
        # Handle URLs like: http://www.linkedin.com/company/vellumai
        url = linkedin_url.rstrip("/")
        if "/company/" in url:
            return url.split("/company/")[-1].split("/")[0]
        return url

    async def get_company_profile(self, linkedin_url: str) -> dict[str, Any]:
        """Get company profile from LinkedIn URL."""
        try:
            company_slug = self._extract_company_slug(linkedin_url)
            result = await self._call_tool(
                "get_company_profile",
                {"company_name": company_slug}
            )
            return {
                "name": result.get("name"),
                "description": result.get("description") or result.get("about") or result.get("overview"),
                "website": result.get("website") or result.get("company_url"),
                "industry": result.get("industry"),
                "raw": result
            }
        except Exception as e:
            return {"error": str(e)}

    async def close_session(self) -> None:
        """Close the browser session."""
        try:
            await self._call_tool("close_session", {})
        except Exception:
            pass
