import type { ProviderFailureClassification } from "@/lib/provider-health";

export function planOutboundAutoRetry(input: {
  attemptCount: number;
  classification: ProviderFailureClassification;
}) {
  const retryableCategories = new Set([
    "network_error",
    "rate_limited",
    "temporary_provider_error",
    "unknown",
  ]);

  const retryable = retryableCategories.has(input.classification.category);
  const autoRetry =
    retryable &&
    Boolean(input.classification.retryDelayMs) &&
    input.attemptCount < 3;

  return {
    autoRetry,
    retryAt:
      autoRetry && input.classification.retryDelayMs
        ? new Date(Date.now() + input.classification.retryDelayMs)
        : null,
    retryable,
  };
}
