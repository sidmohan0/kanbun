export type ProviderFailureClassification = {
  accountStatus: "degraded" | "reconnect_required";
  category:
    | "auth_reconnect_required"
    | "invalid_recipient"
    | "network_error"
    | "permission_reconnect_required"
    | "rate_limited"
    | "temporary_provider_error"
    | "cursor_reset"
    | "unknown";
  operatorAction: string;
  retryDelayMs: number | null;
};

export type ProviderOperation =
  | "contactSync"
  | "outboundSend"
  | "replySync";

type DerivedAccountStatus =
  | "connected"
  | "degraded"
  | "disconnected"
  | "reconnect_required";

function operationStatusKey(operation: ProviderOperation) {
  return `${operation}Status`;
}

function operationErrorKey(operation: ProviderOperation) {
  return `${operation}LastError`;
}

function operationErrorAtKey(operation: ProviderOperation) {
  return `${operation}LastErrorAt`;
}

function operationFailureCategoryKey(operation: ProviderOperation) {
  return `${operation}FailureCategory`;
}

function operationLastRunAtKey(operation: ProviderOperation) {
  return `${operation}LastRunAt`;
}

function operationOperatorActionKey(operation: ProviderOperation) {
  return `${operation}OperatorAction`;
}

function operationRetryAtKey(operation: ProviderOperation) {
  return `${operation}RetryAt`;
}

function operationSuccessAtKey(operation: ProviderOperation) {
  return `${operation}LastSuccessAt`;
}

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

export function classifyOutboundProviderFailure(
  message: string,
): ProviderFailureClassification {
  const normalized = message.toLowerCase();

  if (
    normalized.includes("invalid recipient") ||
    normalized.includes("recipient address rejected") ||
    normalized.includes("primary email is required")
  ) {
    return {
      accountStatus: "degraded",
      category: "invalid_recipient",
      operatorAction:
        "Fix the recipient email on the contact before retrying this send.",
      retryDelayMs: null,
    };
  }

  return classifyProviderFailure(message);
}

export function applyProviderFailureMetadata(
  metadata: Record<string, unknown> | null | undefined,
  input: {
    classification: ProviderFailureClassification;
    message: string;
    operation: ProviderOperation;
    timestamp?: Date;
    values?: Record<string, unknown>;
  },
) {
  const occurredAt = input.timestamp ?? new Date();

  return {
    ...(metadata ?? {}),
    ...input.values,
    [operationStatusKey(input.operation)]: input.classification.accountStatus,
    [operationErrorKey(input.operation)]: input.message,
    [operationErrorAtKey(input.operation)]: occurredAt.toISOString(),
    [operationFailureCategoryKey(input.operation)]:
      input.classification.category,
    [operationLastRunAtKey(input.operation)]: occurredAt.toISOString(),
    [operationOperatorActionKey(input.operation)]:
      input.classification.operatorAction,
    [operationRetryAtKey(input.operation)]: input.classification.retryDelayMs
      ? new Date(occurredAt.getTime() + input.classification.retryDelayMs).toISOString()
      : null,
  };
}

export function applyProviderSuccessMetadata(
  metadata: Record<string, unknown> | null | undefined,
  input: {
    operation: ProviderOperation;
    timestamp?: Date;
    values?: Record<string, unknown>;
  },
) {
  const occurredAt = input.timestamp ?? new Date();

  return {
    ...(metadata ?? {}),
    ...input.values,
    [operationStatusKey(input.operation)]: "connected",
    [operationErrorKey(input.operation)]: null,
    [operationErrorAtKey(input.operation)]: null,
    [operationFailureCategoryKey(input.operation)]: null,
    [operationLastRunAtKey(input.operation)]: occurredAt.toISOString(),
    [operationOperatorActionKey(input.operation)]: null,
    [operationRetryAtKey(input.operation)]: null,
    [operationSuccessAtKey(input.operation)]: occurredAt.toISOString(),
  };
}

export function deriveProviderAccountStatus(input: {
  metadata: Record<string, unknown> | null | undefined;
  missingScopes?: string[];
  rawStatus: string | null | undefined;
}): DerivedAccountStatus {
  if (input.rawStatus === "disconnected") {
    return "disconnected";
  }

  if ((input.missingScopes?.length ?? 0) > 0) {
    return "reconnect_required";
  }

  const operationStatuses = (
    ["contactSync", "replySync", "outboundSend"] as ProviderOperation[]
  )
    .map((operation) => getMetadataString(input.metadata, operationStatusKey(operation)))
    .filter((value): value is DerivedAccountStatus => Boolean(value));

  if (operationStatuses.includes("reconnect_required")) {
    return "reconnect_required";
  }

  if (operationStatuses.includes("degraded")) {
    return "degraded";
  }

  if (operationStatuses.includes("connected")) {
    return "connected";
  }

  if (input.rawStatus === "reconnect_required") {
    return "reconnect_required";
  }

  if (input.rawStatus === "degraded") {
    return "degraded";
  }

  return "connected";
}
