import type { Metadata } from "next";
import {
  disconnectGoogleAccountAction,
  disconnectMicrosoftAccountAction,
  requestGoogleSyncAction,
  requestMicrosoftSyncAction,
  requestTodoistSyncAction,
  startGoogleConnectAction,
  startMicrosoftConnectAction,
} from "@/app/actions/integrations";
import { IntegrationCard } from "@/components/app/settings/integration-card";
import { OperatorPanel } from "@/components/app/settings/operator-panel";
import { SettingsFeedback } from "@/components/app/settings/settings-feedback";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { getPersistentOwnerUserId, requireUser } from "@/lib/auth";
import { listConnectedAccountsForUser } from "@/lib/connected-accounts";
import { isGoogleOAuthConfigured } from "@/lib/google";
import { isMicrosoftOAuthConfigured } from "@/lib/microsoft";
import {
  getTodoistManagedAccountForUser,
  isTodoistApiTokenConfigured,
} from "@/lib/todoist";

export const metadata: Metadata = {
  title: "Settings | Kanbun",
  description:
    "Manage connected accounts, operator preferences, and workspace controls.",
};

function todoistMirrorCount(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return 0;
  }

  const count = (metadata as Record<string, unknown>).lastReconciledTaskCount;
  return typeof count === "number" ? count : 0;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, user, persistentOwnerUserId] = await Promise.all([
    searchParams,
    requireUser(),
    getPersistentOwnerUserId(),
  ]);
  const [accounts, todoistAccount] = await Promise.all([
    listConnectedAccountsForUser(persistentOwnerUserId),
    getTodoistManagedAccountForUser(persistentOwnerUserId),
  ]);
  const googleAccount =
    accounts.find((account) => account.provider === "google") ?? null;
  const microsoftAccount =
    accounts.find((account) => account.provider === "microsoft") ?? null;
  const googleConfigured = isGoogleOAuthConfigured();
  const microsoftConfigured = isMicrosoftOAuthConfigured();
  const todoistConfigured = isTodoistApiTokenConfigured();
  const connected =
    typeof params.connected === "string" ? params.connected : undefined;
  const disconnected =
    typeof params.disconnected === "string" ? params.disconnected : undefined;
  const synced = typeof params.synced === "string" ? params.synced : undefined;
  const error =
    typeof params.error === "string" ? decodeURIComponent(params.error) : null;

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
      <DashboardPanel>
        <SectionHeading
          eyebrow="Connected accounts"
          title="Integration health"
          description="Settings stays utilitarian: account state, token health, and sync controls live here."
        />

        <div className="space-y-3">
          <SettingsFeedback
            connected={connected}
            disconnected={disconnected}
            error={error}
            synced={synced}
          />
          <IntegrationCard
            account={googleAccount}
            configured={googleConfigured}
            connectAction={startGoogleConnectAction}
            connectDescription="Connect Google to sync People contacts into Kanbun."
            connectLabel="Connect Google"
            disconnectAction={disconnectGoogleAccountAction}
            disconnectLabel="Disconnect Google"
            metricLabel="Contacts synced"
            metricValue={googleAccount?.lastSyncedContactCount ?? 0}
            name="Gmail"
            syncAction={requestGoogleSyncAction}
            syncLabel="Run Google sync"
          />
          <IntegrationCard
            account={microsoftAccount}
            configured={microsoftConfigured}
            connectAction={startMicrosoftConnectAction}
            connectDescription="Connect Microsoft to sync Graph contacts into Kanbun."
            connectLabel="Connect Microsoft"
            disconnectAction={disconnectMicrosoftAccountAction}
            disconnectLabel="Disconnect Microsoft"
            metricLabel="Contacts synced"
            metricValue={microsoftAccount?.lastSyncedContactCount ?? 0}
            name="Microsoft Outlook"
            syncAction={requestMicrosoftSyncAction}
            syncLabel="Run Microsoft sync"
          />
          <IntegrationCard
            account={todoistAccount}
            configured={todoistConfigured}
            connectAction={requestTodoistSyncAction}
            connectDescription="Configure TODOIST_API_TOKEN to mirror Kanbun follow-ups into your daily task flow."
            connectLabel="Initialize Todoist"
            metricLabel="Mirrored tasks"
            metricValue={todoistMirrorCount(todoistAccount?.metadata)}
            name="Todoist"
            notConfiguredLabel="token not configured"
            syncAction={requestTodoistSyncAction}
            syncLabel="Run Todoist reconcile"
          />
        </div>
      </DashboardPanel>

      <OperatorPanel userEmail={user.email} />
    </div>
  );
}
