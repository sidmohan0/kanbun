import { DashboardPanel, SectionHeading } from "@/components/app/ui";

export function OperatorPanel({ userEmail }: { userEmail: string }) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Operator"
        title="Workspace controls"
        description="This pane keeps the human-readable operating status close to the account actions."
      />

      <div className="space-y-3">
        <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4">
          <p className="text-sm font-medium text-foreground">Owner mode</p>
          <p className="mt-1 text-sm text-muted-foreground">{userEmail}</p>
        </div>
        <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4 text-sm text-muted-foreground">
          Google and Microsoft sync canonical contacts into Kanbun, while
          Todoist mirrors selected tasks without becoming the workflow source of
          truth.
        </div>
        <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4 text-sm text-muted-foreground">
          Run `pnpm worker` in a second terminal during local development so
          queued imports, provider sync requests, and Todoist task mirroring are
          processed outside the web runtime.
        </div>
      </div>
    </DashboardPanel>
  );
}
