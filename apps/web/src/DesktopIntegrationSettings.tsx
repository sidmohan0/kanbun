import { Button } from "./components/ui/button";

export function isDesktopApplication(userAgent = navigator.userAgent): boolean {
  return userAgent.includes("KanbunDesktop/");
}

/** The desktop shell recognizes this exact settings-only handoff and removes the marker. */
export function browserIntegrationSettingsUrl(origin = location.origin): string {
  return new URL("/?kanbun-browser=integrations#settings/integrations", origin).href;
}

export function DesktopIntegrationSettings({ name }: { name: string }) {
  return (
    <section className="github-settings" aria-label={`${name} connection`}>
      <h2>{name}</h2>
      <p>Manage this connection in your browser. Sign in there, then connect your account.</p>
      <Button variant="outline" asChild>
        <a href={browserIntegrationSettingsUrl()} target="_blank" rel="noreferrer">
          Manage {name} in browser
        </a>
      </Button>
      <p>If this opens in Kanbun, copy this address and paste it into your browser:</p>
      <p>
        <code className="break-all select-text">{new URL("/#settings/integrations", location.origin).href}</code>
      </p>
      <p>Your browser and desktop sessions stay separate. Reload Kanbun after changing the connection.</p>
    </section>
  );
}
