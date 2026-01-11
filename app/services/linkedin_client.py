# app/services/linkedin_client.py
import httpx
from typing import Any


class LinkedInMCPClient:
    def __init__(self, server_url: str):
        self.server_url = server_url.rstrip("/")

    async def _call_tool(self, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.server_url}/mcp/tools/call",
                json={
                    "name": tool_name,
                    "arguments": arguments
                },
                timeout=60.0
            )
            response.raise_for_status()
            return response.json()

    async def get_company_profile(self, linkedin_url: str) -> dict[str, Any]:
        result = await self._call_tool(
            "get_company_profile",
            {"url": linkedin_url}
        )
        return {
            "name": result.get("name"),
            "description": result.get("description") or result.get("about"),
            "website": result.get("website"),
            "industry": result.get("industry"),
            "raw": result
        }

    async def close_session(self) -> None:
        try:
            await self._call_tool("close_session", {})
        except Exception:
            pass
