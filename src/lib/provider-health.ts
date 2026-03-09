export type ProviderFailureClassification = {
  accountStatus: "degraded" | "reconnect_required";
  category:
    | "auth_reconnect_required"
    | "permission_reconnect_required"
    | "rate_limited"
    | "temporary_provider_error"
    | "network_error"
    | "cursor_reset"
    | "unknown";
  operatorAction: string;
  retryDelayMs: number | null;
};

export function getMetadataString(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

export function getMetadataNumber(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") {
    return 0;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

export function getMetadataBoolean(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : null;
}

export function getMetadataDate(metadata: unknown, key: string) {
  const value = getMetadataString(metadata, key);

  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function classifyProviderFailure(
  message: string,
): ProviderFailureClassification {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("missing refresh token") ||
    normalized.includes("invalid_grant") ||
    normalized.includes("invalid credentials") ||
    normalized.includes("(401)")
  ) {
    return {
      accountStatus: "reconnect_required",
      category: "auth_reconnect_required",
      operatorAction: "Reconnect this account to refresh the provider tokens.",
      retryDelayMs: null,
    };
  }

  if (
    normalized.includes("insufficient permission") ||
    normalized.includes("insufficient permissions") ||
    normalized.includes("insufficient authentication scopes") ||
    normalized.includes("consent") ||
    normalized.includes("(403)")
  ) {
    return {
      accountStatus: "reconnect_required",
      category: "permission_reconnect_required",
      operatorAction:
        "Reconnect this account and approve the required provider scopes.",
      retryDelayMs: null,
    };
  }

  if (
    normalized.includes("(429)") ||
    normalized.includes("rate limit") ||
    normalized.includes("quota")
  ) {
    return {
      accountStatus: "degraded",
      category: "rate_limited",
      operatorAction:
        "Wait for the backoff window or reduce sync pressure before retrying.",
      retryDelayMs: 1000 * 60 * 15,
    };
  }

  if (
    normalized.includes("(410)") ||
    normalized.includes("sync token") ||
    normalized.includes("delta token") ||
    normalized.includes("cursor")
  ) {
    return {
      accountStatus: "degraded",
      category: "cursor_reset",
      operatorAction:
        "Kanbun will retry from a reset cursor. Reconnect only if the issue persists.",
      retryDelayMs: 1000 * 60,
    };
  }

  if (
    normalized.includes("network") ||
    normalized.includes("fetch failed") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("timeout")
  ) {
    return {
      accountStatus: "degraded",
      category: "network_error",
      operatorAction: "Retry after the short backoff window.",
      retryDelayMs: 1000 * 60 * 2,
    };
  }

  if (
    normalized.includes("(500)") ||
    normalized.includes("(502)") ||
    normalized.includes("(503)") ||
    normalized.includes("(504)")
  ) {
    return {
      accountStatus: "degraded",
      category: "temporary_provider_error",
      operatorAction: "Retry after the provider backoff window.",
      retryDelayMs: 1000 * 60 * 5,
    };
  }

  return {
    accountStatus: "degraded",
    category: "unknown",
    operatorAction: "Review the latest provider error and retry once resolved.",
    retryDelayMs: 1000 * 60 * 5,
  };
}
