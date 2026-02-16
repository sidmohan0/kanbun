import type { Contact } from "../shared/types.js";

export class ApolloService {
  constructor(private serverUrl: string) {}

  async connect(): Promise<void> {
    const res = await fetch(`${this.serverUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error("Apollo MCP server not reachable");
  }

  async search(
    query: string,
    limit: number = 25
  ): Promise<Array<Partial<Contact> & { apollo_id: string }>> {
    const res = await fetch(`${this.serverUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async importList(
    listId: string
  ): Promise<Array<Partial<Contact> & { apollo_id: string }>> {
    const res = await fetch(`${this.serverUrl}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listId }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async enrich(email: string): Promise<Partial<Contact> & { apollo_id: string } | null> {
    const res = await fetch(`${this.serverUrl}/enrich`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  async enrichOrg(domain: string): Promise<Record<string, any> | null> {
    const res = await fetch(`${this.serverUrl}/enrich-org`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }
}
