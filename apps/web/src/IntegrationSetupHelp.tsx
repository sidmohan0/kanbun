import { Button } from "./components/ui/button";

export type IntegrationProvider = "GitHub" | "Slack" | "Google Sheets";

const setupDocs: Record<IntegrationProvider, string> = {
  GitHub: "https://github.com/sidmohan0/kanbun/blob/main/docs/github-integration.md",
  Slack: "https://github.com/sidmohan0/kanbun/blob/main/docs/slack-integration.md",
  "Google Sheets": "https://github.com/sidmohan0/kanbun/blob/main/docs/google-sheets-integration.md",
};

/** Explain the service credential / workspace authorization boundary without requesting secrets. */
export function IntegrationSetupHelp({
  provider,
  unavailable = false,
  authorization,
}: {
  provider: IntegrationProvider;
  unavailable?: boolean;
  authorization?: { label: string; busy: boolean; onAuthorize: () => void; variant?: "default" | "outline" };
}) {
  return (
    <aside className="integration-setup-help" aria-label={`${provider} setup information`}>
      {unavailable ? (
        <p>
          {provider} is not enabled for this Kanbun installation yet. The service administrator must register and
          configure the provider app before workspace owners can connect it. Do not enter provider app secrets here.
        </p>
      ) : (
        <p>
          Workspace owners connect {provider} from Settings → Integrations. Provider app credentials belong to the
          Kanbun service and are never stored in this browser or desktop app. You authorize only the workspace access
          shown by {provider}.
        </p>
      )}
      {authorization && (
        <Button
          variant={authorization.variant ?? "outline"}
          disabled={authorization.busy}
          onClick={authorization.onAuthorize}
        >
          {authorization.busy ? "Please wait…" : authorization.label}
        </Button>
      )}
      <p>
        <a href={setupDocs[provider]} target="_blank" rel="noreferrer">
          View {provider} setup and recovery guide
        </a>
      </p>
    </aside>
  );
}
