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

function pickPrimaryProviderAccount<
  T extends { provider: string; status: string },
>(accounts: T[], provider: string) {
  return (
    accounts.find(
      (account) =>
        account.provider === provider && account.status !== "disconnected",
    ) ??
    accounts.find((account) => account.provider === provider) ??
    null
  );
}

function todoistMirrorCount(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") {
    return 0;
  }

  const count = (metadata as Record<string, unknown>).lastReconciledTaskCount;
  return typeof count === "number" ? count : 0;
}

function providerNotes(account: {
  contactSyncFailureCategory?: string | null;
  contactSyncLastError?: string | null;
  contactSyncLastResultCount?: number;
  contactSyncLastRunAt?: Date | null;
  contactSyncLastSuccessAt?: Date | null;
  contactSyncMode?: string | null;
  contactSyncOperatorAction?: string | null;
  contactSyncRetryAt?: Date | null;
  missingScopes?: string[];
  outboundSendFailureCategory?: string | null;
  outboundSendLastError?: string | null;
  outboundSendLastErrorAt?: Date | null;
  outboundSendLastMessageId?: string | null;
  outboundSendLastRunAt?: Date | null;
  outboundSendLastSuccessAt?: Date | null;
  outboundSendOperatorAction?: string | null;
  outboundSendRetryAt?: Date | null;
  replySyncLastDetectedCount?: number;
  replySyncFailureCategory?: string | null;
  replySyncLastCheckedCount?: number;
  replySyncLastError?: string | null;
  replySyncLastRunAt?: Date | null;
  replySyncLastSuccessAt?: Date | null;
  replySyncMode?: string | null;
  replySyncOperatorAction?: string | null;
  replySyncRetryAt?: Date | null;
} | null) {
  if (!account) {
    return [];
  }

  const notes: string[] = [];

  if (account.contactSyncMode) {
    notes.push(`Contact sync mode: ${account.contactSyncMode.replaceAll("_", " ")}`);
  }

  if (account.contactSyncLastRunAt) {
    notes.push(
      `Last contact sync: ${account.contactSyncLastRunAt.toLocaleString()} (${account.contactSyncLastResultCount ?? 0} contacts touched)`,
    );
  }

  if (account.contactSyncFailureCategory) {
    notes.push(
      `Contact sync health: ${account.contactSyncFailureCategory.replaceAll("_", " ")}`,
    );
  }

  if (account.contactSyncRetryAt) {
    notes.push(
      `Contact sync retry scheduled for ${account.contactSyncRetryAt.toLocaleString()}`,
    );
  }

  if (account.contactSyncOperatorAction) {
    notes.push(account.contactSyncOperatorAction);
  }

  if (account.replySyncMode) {
    notes.push(`Reply tracking mode: ${account.replySyncMode}`);
  }

  if (account.replySyncLastRunAt) {
    notes.push(
      `Last reply scan: ${account.replySyncLastRunAt.toLocaleString()} (${account.replySyncLastCheckedCount ?? 0} checked, ${account.replySyncLastDetectedCount ?? 0} detected)`,
    );
  }

  if (account.replySyncFailureCategory) {
    notes.push(
      `Reply sync health: ${account.replySyncFailureCategory.replaceAll("_", " ")}`,
    );
  }

  if (account.replySyncRetryAt) {
    notes.push(
      `Reply sync retry scheduled for ${account.replySyncRetryAt.toLocaleString()}`,
    );
  }

  if (account.replySyncOperatorAction) {
    notes.push(account.replySyncOperatorAction);
  }

  if (account.outboundSendLastRunAt) {
    notes.push(
      `Last outbound send check: ${account.outboundSendLastRunAt.toLocaleString()}${account.outboundSendLastMessageId ? ` (message ${account.outboundSendLastMessageId.slice(0, 8)})` : ""}`,
    );
  }

  if (account.outboundSendLastSuccessAt) {
    notes.push(
      `Last successful send: ${account.outboundSendLastSuccessAt.toLocaleString()}`,
    );
  }

  if (account.outboundSendFailureCategory) {
    notes.push(
      `Outbound send health: ${account.outboundSendFailureCategory.replaceAll("_", " ")}`,
    );
  }

  if (account.outboundSendRetryAt) {
    notes.push(
      `Outbound retry suggested after ${account.outboundSendRetryAt.toLocaleString()}`,
    );
  }

  if (account.outboundSendOperatorAction) {
    notes.push(account.outboundSendOperatorAction);
  }

  if (account.missingScopes?.length) {
    notes.push(`Reconnect required for missing provider scopes.`);
  }

  return notes;
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
  const googleAccount = pickPrimaryProviderAccount(accounts, "google");
  const microsoftAccount = pickPrimaryProviderAccount(accounts, "microsoft");
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
            connectLabel={googleAccount ? "Reconnect Google" : "Connect Google"}
            disconnectAction={disconnectGoogleAccountAction}
            disconnectLabel="Disconnect Google"
            metricLabel="Contacts synced"
            metricValue={googleAccount?.lastSyncedContactCount ?? 0}
            name="Gmail"
            notes={providerNotes(googleAccount)}
            syncAction={requestGoogleSyncAction}
            syncLabel="Run Google sync"
          />
          <IntegrationCard
            account={microsoftAccount}
            configured={microsoftConfigured}
            connectAction={startMicrosoftConnectAction}
            connectDescription="Connect Microsoft to sync Graph contacts into Kanbun."
            connectLabel={
              microsoftAccount ? "Reconnect Microsoft" : "Connect Microsoft"
            }
            disconnectAction={disconnectMicrosoftAccountAction}
            disconnectLabel="Disconnect Microsoft"
            metricLabel="Contacts synced"
            metricValue={microsoftAccount?.lastSyncedContactCount ?? 0}
            name="Microsoft Outlook"
            notes={providerNotes(microsoftAccount)}
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
