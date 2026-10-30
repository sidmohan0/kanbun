import { useEffect, useState } from "react";
import { App } from "./App";
import { Invitation } from "./Invitation";

function invitationToken(): string | null {
  if (!location.hash.startsWith("#invite/")) return null;
  try {
    return decodeURIComponent(location.hash.slice("#invite/".length));
  } catch {
    return "";
  }
}
/** Invitation entry must render before any workspace lease, cached rows, or mutation queue is opened. */
export function Entry() {
  const [token, setToken] = useState(invitationToken);
  useEffect(() => {
    const route = () => setToken(invitationToken());
    window.addEventListener("hashchange", route);
    return () => window.removeEventListener("hashchange", route);
  }, []);
  return token === null ? <App /> : <Invitation key={token} token={token} />;
}
