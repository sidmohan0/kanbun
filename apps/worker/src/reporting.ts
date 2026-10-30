/** Report a bounded event and return its correlation id without serializing the thrown value.
 * Errors may embed SQL, issue content, tokens, URLs, or provider responses.
 */
export function internalFailure(error: unknown): Response {
  void error;
  const errorId = crypto.randomUUID();
  console.error({ event: "kanbun.request.failed", category: "internal", errorId });
  return Response.json(
    { error: "Internal workspace error", errorId },
    {
      status: 500,
      headers: { "cache-control": "no-store" },
    },
  );
}
