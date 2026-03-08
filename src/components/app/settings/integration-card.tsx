import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type ConnectedAccountLike = {
  email: string | null;
  lastError: string | null;
  lastSuccessfulSyncAt: Date | null;
  status: string;
};

type IntegrationCardProps = {
  account: ConnectedAccountLike | null;
  configured: boolean;
  connectAction: () => Promise<void>;
  connectDescription: string;
  connectLabel: string;
  disconnectAction: () => Promise<void>;
  disconnectLabel: string;
  metricLabel: string;
  metricValue: string | number;
  name: string;
  syncAction: () => Promise<void>;
  syncLabel: string;
};

function statusVariant(status: string) {
  if (status === "connected") {
    return "secondary";
  }

  if (status === "reconnect_required") {
    return "destructive";
  }

  return "outline";
}

function formatDateTime(value: Date | null) {
  if (!value) {
    return "Not yet";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function IntegrationCard({
  account,
  configured,
  connectAction,
  connectDescription,
  connectLabel,
  disconnectAction,
  disconnectLabel,
  metricLabel,
  metricValue,
  name,
  syncAction,
  syncLabel,
}: IntegrationCardProps) {
  return (
    <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{name}</p>
          <p className="text-sm text-muted-foreground">
            {account?.email ?? connectDescription}
          </p>
        </div>
        <Badge
          variant={statusVariant(
            configured ? (account?.status ?? "disconnected") : "degraded",
          )}
        >
          {!configured
            ? "oauth not configured"
            : (account?.status ?? "disconnected").replaceAll("_", " ")}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-secondary/65 px-3 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Last sync
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {formatDateTime(account?.lastSuccessfulSyncAt ?? null)}
          </p>
        </div>
        <div className="rounded-xl bg-secondary/65 px-3 py-3">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            {metricLabel}
          </p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {metricValue}
          </p>
        </div>
      </div>

      {account?.lastError ? (
        <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/8 px-3 py-3 text-sm text-destructive">
          {account.lastError}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {account ? (
          <>
            <form action={syncAction}>
              <Button type="submit">{syncLabel}</Button>
            </form>
            <form action={disconnectAction}>
              <Button type="submit" variant="outline">
                {disconnectLabel}
              </Button>
            </form>
          </>
        ) : (
          <form action={connectAction}>
            <Button type="submit" disabled={!configured}>
              {connectLabel}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
