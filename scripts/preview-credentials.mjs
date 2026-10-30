/** Accept pasted line wrapping without allowing HTTP errors to echo a credential. */
export function cloudflareToken(raw) {
  const token = typeof raw === "string" ? raw.replace(/\s+/gu, "") : "";
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(token))
    throw new Error("CLOUDFLARE_API_TOKEN must contain a valid API token value; update the Actions secret.");
  return token;
}
