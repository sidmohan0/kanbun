const BASE = "https://api.apollo.io/v1";

export class ApolloClient {
  constructor(private apiKey: string) {}

  private async request(method: string, path: string, body?: any) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": this.apiKey
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Apollo API error: ${res.status} ${text}`);
    }

    return res.json();
  }

  async searchPeople(query: string, limit = 25) {
    // mixed_people/search requires a paid plan — fall back to enrichment-based lookup
    // Try it first, and if 403, return a clear message
    try {
      const data = await this.request("POST", "/mixed_people/search", {
        q_keywords: query,
        page: 1,
        per_page: limit
      });
      return (data.people ?? []).map((p: any) => this.normalize(p));
    } catch (e: any) {
      if (e.message.includes("403") || e.message.includes("API_INACCESSIBLE")) {
        throw new Error(
          "People search requires a paid Apollo plan. Use /enrich with an email or /enrich-org with a domain instead."
        );
      }
      throw e;
    }
  }

  async enrich(email: string) {
    const data = await this.request("POST", "/people/match", { email });
    return data.person ? this.normalize(data.person) : null;
  }

  async enrichOrg(domain: string) {
    const data = await this.request("GET", `/organizations/enrich?domain=${encodeURIComponent(domain)}`);
    return data.organization
      ? {
          name: data.organization.name ?? "",
          domain: data.organization.website_url ?? "",
          industry: data.organization.industry ?? "",
          employee_count: data.organization.estimated_num_employees ?? null,
          linkedin_url: data.organization.linkedin_url ?? "",
          apollo_id: data.organization.id ?? ""
        }
      : null;
  }

  async importList(listId: string) {
    const data = await this.request("POST", `/lists/${listId}/people`, {});
    return (data.people ?? []).map((p: any) => this.normalize(p));
  }

  private normalize(person: any) {
    return {
      first_name: person?.first_name ?? "",
      last_name: person?.last_name ?? "",
      email: person?.email ?? "",
      company: person?.organization?.name ?? "",
      title: person?.title ?? "",
      linkedin_url: person?.linkedin_url ?? "",
      apollo_id: person?.id ?? ""
    };
  }
}
