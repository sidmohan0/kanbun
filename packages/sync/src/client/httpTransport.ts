import type {
  BootstrapResponse,
  LoadRequest,
  LoadResponse,
  PullRequest,
  PullResponse,
  PushRequest,
  PushResponse,
  Transport,
} from "../protocol";

/** Transport over the Worker's /sync/* routes. Cookies carry the session. */
export function httpTransport(baseUrl: string, fetchImpl: typeof fetch = fetch): Transport {
  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const init: RequestInit = { method: "GET", credentials: "include" };
    if (body !== undefined) {
      init.method = "POST";
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(body);
    }
    const res = await fetchImpl(`${baseUrl}${path}`, init);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    bootstrap: (clientId) => call<BootstrapResponse>(`/sync/bootstrap?clientId=${encodeURIComponent(clientId)}`),
    push: (req: PushRequest) => call<PushResponse>("/sync/push", req),
    pull: (req: PullRequest) =>
      call<PullResponse>(`/sync/pull?clientId=${encodeURIComponent(req.clientId)}&since=${req.since}`),
    load: (req: LoadRequest) =>
      call<LoadResponse>(`/sync/load?model=${req.model}&parentId=${encodeURIComponent(req.parentId)}`),
  };
}
