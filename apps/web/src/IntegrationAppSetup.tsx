import { useEffect, useState, type FormEvent } from "react";
import { membershipRequest } from "./membership";
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";

type ProviderId = "github" | "slack" | "google-sheets";
type Field = { key: string; label: string; secret?: boolean; multiline?: boolean; hint: string };
type ProviderStatus = {
  provider: ProviderId;
  configured: boolean;
  configuredAt: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
  revision: string | null;
  callbackUrl: string;
  scopes: string[];
  webhookUrl?: string;
  eventsUrl?: string;
  interactionsUrl?: string;
};
type SetupStatus = { enabled: boolean; providers?: ProviderStatus[] };

const definitions: Record<ProviderId, { title: string; description: string; fields: Field[] }> = {
  github: {
    title: "GitHub App",
    description: "Create a GitHub App for this Kanbun workspace. Install it on the repositories you want to connect.",
    fields: [
      { key: "appId", label: "App ID", hint: "Numeric ID shown in GitHub App settings." },
      { key: "appSlug", label: "App slug", hint: "The slug in https://github.com/apps/{slug}." },
      { key: "clientId", label: "Client ID", hint: "OAuth client ID from the GitHub App settings." },
      { key: "clientSecret", label: "Client secret", secret: true, hint: "Leave blank to keep the saved value." },
      {
        key: "privateKey",
        label: "Private key (PEM)",
        secret: true,
        multiline: true,
        hint: "Convert GitHub's downloaded RSA key to PKCS#8 PEM with a BEGIN PRIVATE KEY header. It is sent only to the server and never returned.",
      },
      {
        key: "webhookSecret",
        label: "Webhook secret",
        secret: true,
        hint: "Set the same value in the GitHub App webhook settings.",
      },
    ],
  },
  slack: {
    title: "Slack App",
    description: "Create a Slack app for this workspace and configure its OAuth redirect and request URLs below.",
    fields: [
      { key: "appId", label: "App ID", hint: "Starts with A; shown under Basic Information." },
      { key: "clientId", label: "Client ID", hint: "OAuth client ID from Basic Information." },
      { key: "clientSecret", label: "Client secret", secret: true, hint: "Leave blank to keep the saved value." },
      {
        key: "signingSecret",
        label: "Signing secret",
        secret: true,
        hint: "Used to verify Events API and interaction requests.",
      },
    ],
  },
  "google-sheets": {
    title: "Google OAuth client",
    description: "Create a web OAuth client in Google Cloud. Add the redirect URI below and enable the Sheets API.",
    fields: [
      {
        key: "clientId",
        label: "OAuth client ID",
        hint: "Web application client ID ending in .apps.googleusercontent.com.",
      },
      { key: "clientSecret", label: "OAuth client secret", secret: true, hint: "Leave blank to keep the saved value." },
    ],
  },
};

const blankFields = (provider: ProviderId) =>
  Object.fromEntries(definitions[provider].fields.map((field) => [field.key, ""]));

function ProviderForm({ status, changed }: { status: ProviderStatus; changed: () => void }) {
  const { title, description, fields } = definitions[status.provider];
  const [values, setValues] = useState<Record<string, string>>(() => blankFields(status.provider));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await membershipRequest(`/api/integration-apps/${status.provider}`, values, "PUT");
      setValues(blankFields(status.provider));
      setMessage(
        "Provider app settings saved. Connect or reconnect the workspace authorization to verify the app credentials.",
      );
      changed();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Provider settings could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await membershipRequest(`/api/integration-apps/${status.provider}`, {}, "DELETE");
      setValues(blankFields(status.provider));
      setMessage("Provider app settings deleted. Existing provider authorization may need separate revocation.");
      changed();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Provider settings could not be deleted.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="team-form integration-app-form"
      onSubmit={(event) => void save(event)}
      aria-label={`${title} setup`}
    >
      <h3>{title}</h3>
      <p>{description}</p>
      <p role="status">
        {!status.configured
          ? "Not configured"
          : status.verifiedAt
            ? `OAuth verified · ${status.verifiedAt}`
            : `Saved · not yet verified · updated ${status.updatedAt}`}
      </p>
      <p>
        OAuth redirect URI: <code className="break-all select-text">{status.callbackUrl}</code>
      </p>
      {status.webhookUrl && (
        <p>
          GitHub webhook URL: <code className="break-all select-text">{status.webhookUrl}</code>
        </p>
      )}
      {status.eventsUrl && (
        <p>
          Slack Events URL: <code className="break-all select-text">{status.eventsUrl}</code>
        </p>
      )}
      {status.interactionsUrl && (
        <p>
          Slack Interactivity URL: <code className="break-all select-text">{status.interactionsUrl}</code>
        </p>
      )}
      <p>Requested permissions: {status.scopes.join(", ")}.</p>
      {fields.map((field) => (
        <label key={field.key} className="integration-app-field">
          {field.label}
          {field.multiline ? (
            <Textarea
              autoComplete="new-password"
              value={values[field.key] ?? ""}
              placeholder={
                status.configured ? "Saved value is hidden; leave blank to keep it" : "Paste the private key"
              }
              disabled={busy}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          ) : (
            <Input
              type={field.secret ? "password" : "text"}
              autoComplete={field.secret ? "new-password" : "off"}
              value={values[field.key] ?? ""}
              placeholder={field.secret && status.configured ? "Saved value is hidden; leave blank to keep it" : ""}
              disabled={busy}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
            />
          )}
          <span className="muted">{field.hint}</span>
        </label>
      ))}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="integration-app-actions">
        <Button className="button primary" disabled={busy}>
          {busy ? "Saving…" : status.configured ? "Save provider settings" : "Save provider app"}
        </Button>
        {status.configured && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>
            Delete provider settings
          </Button>
        )}
      </div>
    </form>
  );
}

export function IntegrationAppSetup({ onChanged }: { onChanged?: () => void }) {
  const [state, setState] = useState<SetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    void membershipRequest("/api/integration-apps")
      .then((value) => {
        if (active) setState(value as SetupStatus);
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : "Provider app settings could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [revision]);
  if (error)
    return (
      <p className="notice" role="alert">
        {error}
      </p>
    );
  if (!state || !state.enabled || !Array.isArray(state.providers)) return null;
  const changed = () => {
    setRevision((value) => value + 1);
    onChanged?.();
  };
  return (
    <section className="integration-app-setup" aria-label="Provider app credentials">
      <h2>Provider app setup</h2>
      <p>
        Self-hosted workspace owners can use their own provider apps. Values are encrypted on the server; secret fields
        stay blank after save and are never sent back to the browser. Connect below separately to authorize this
        workspace.
      </p>
      <p>
        Rotating an app secret may require reconnecting the provider. Deleting these settings does not automatically
        revoke a grant at the provider.
      </p>
      {state.providers.map((status) => (
        <ProviderForm key={status.provider} status={status} changed={changed} />
      ))}
    </section>
  );
}
