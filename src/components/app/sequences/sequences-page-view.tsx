import {
  addSequenceStepAction,
  approveOutboundDraftAction,
  cancelOutboundMessageAction,
  createSequenceAction,
  deleteSequenceStepAction,
  pauseSequenceAction,
  resumeSequenceAction,
  retryOutboundMessageAction,
  updateSequenceAction,
  updateSequenceStepAction,
} from "@/app/actions/sequences";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getPersistentOwnerUserId } from "@/lib/auth";
import {
  listPendingOutboundApprovals,
  listSendCapableAccountsForUser,
  listSequencesOverview,
} from "@/lib/sequences";

function formatDueAt(value: Date | null) {
  if (!value) {
    return "No due work scheduled";
  }

  return value.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function outboundDiagnosticMetadata(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      attemptCount: 0,
      blockedReason: null as string | null,
      copyRevision: 0,
      deliveryDiagnostic: null as string | null,
      deliveryState: null as string | null,
      failureCategory: null as string | null,
      retryable: true,
    };
  }

  const metadata = value as Record<string, unknown>;

  return {
    attemptCount:
      typeof metadata.attemptCount === "number" ? metadata.attemptCount : 0,
    blockedReason:
      typeof metadata.blockedReason === "string" ? metadata.blockedReason : null,
    copyRevision:
      typeof metadata.copyRevision === "number" ? metadata.copyRevision : 0,
    deliveryDiagnostic:
      typeof metadata.deliveryDiagnostic === "string"
        ? metadata.deliveryDiagnostic
        : null,
    deliveryState:
      typeof metadata.deliveryState === "string" ? metadata.deliveryState : null,
    failureCategory:
      typeof metadata.failureCategory === "string"
        ? metadata.failureCategory
        : null,
    retryable:
      typeof metadata.retryable === "boolean" ? metadata.retryable : true,
  };
}

function feedbackMessage(params: Record<string, string | string[] | undefined>) {
  if (params.created === "1") {
    return "Sequence created and ready for enrollment.";
  }

  if (params.updated === "1") {
    return "Sequence settings updated.";
  }

  if (params.queued === "1") {
    return "Outbound item saved and queued. The worker will send it when policy allows.";
  }

  if (params.cancelled === "1") {
    return "Outbound item cancelled and the affected enrollment was stopped.";
  }

  if (params.step === "added") {
    return "Sequence step added.";
  }

  if (params.step === "updated") {
    return "Sequence step updated.";
  }

  if (params.step === "deleted") {
    return "Sequence step deleted.";
  }

  return null;
}

function SequencesHeader(props: {
  approvalsCount: number;
  error: string | null;
  feedback: string | null;
  sendAccounts: Awaited<ReturnType<typeof listSendCapableAccountsForUser>>;
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Sequences"
        title="Reusable outreach with operator control"
        description="Kanbun now supports multi-step sequence editing, policy-aware queueing, and manual review before every send."
      />

      {props.error ? (
        <div className="mt-5 rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {props.error}
        </div>
      ) : null}

      {props.feedback ? (
        <div className="mt-5 rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
          {props.feedback}
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-secondary/65 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Send-capable accounts
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {props.sendAccounts.length}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {props.sendAccounts.length === 0
              ? "Reconnect Gmail or Outlook after the new send scopes were added."
              : props.sendAccounts
                  .map((account) => account.email ?? account.provider)
                  .join(" · ")}
          </p>
        </div>
        <div className="rounded-2xl bg-secondary/65 px-4 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Needs attention
          </p>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {props.approvalsCount}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Failed sends return here for retry, and queued sends still obey
            send windows plus daily caps.
          </p>
        </div>
      </div>
    </DashboardPanel>
  );
}

function CreateSequencePanel() {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="New sequence"
        title="Create the first step"
        description="New sequences start active, manual-review only, with explicit send windows and per-day account caps."
      />
      <form action={createSequenceAction} className="mt-5 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Sequence name</span>
            <input
              name="name"
              placeholder="Founder re-engagement"
              className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
              required
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Delay days</span>
            <input
              name="delayDays"
              type="number"
              min={0}
              defaultValue={0}
              className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
            />
          </label>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Window start</span>
            <input
              name="sendWindowStartHour"
              type="number"
              min={0}
              max={23}
              defaultValue={8}
              className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Window end</span>
            <input
              name="sendWindowEndHour"
              type="number"
              min={0}
              max={23}
              defaultValue={17}
              className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="text-muted-foreground">Daily cap</span>
            <input
              name="dailySendCap"
              type="number"
              min={1}
              defaultValue={25}
              className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
            />
          </label>
        </div>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">Description</span>
          <textarea
            name="description"
            rows={2}
            placeholder="Short context for when and why this sequence gets used."
            className="border-border/80 bg-background w-full rounded-2xl border px-3 py-3 outline-none"
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">Subject template</span>
          <input
            name="subjectTemplate"
            placeholder="Quick follow-up, {{first_name}}"
            className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
            required
          />
        </label>

        <label className="space-y-2 text-sm">
          <span className="text-muted-foreground">Body template</span>
          <textarea
            name="bodyTemplate"
            rows={8}
            placeholder={"Hi {{first_name}},\n\nWanted to follow up on ..."}
            className="border-border/80 bg-background w-full rounded-2xl border px-3 py-3 font-mono text-sm outline-none"
            required
          />
        </label>

        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Variables: <code>{"{{first_name}}"}</code>,{" "}
            <code>{"{{full_name}}"}</code>, <code>{"{{company}}"}</code>,{" "}
            <code>{"{{title}}"}</code>, <code>{"{{sequence_name}}"}</code>
          </p>
          <Button type="submit">Create sequence</Button>
        </div>
      </form>
    </DashboardPanel>
  );
}

function SequenceEditorPanel(props: {
  sequences: Awaited<ReturnType<typeof listSequencesOverview>>;
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Sequence editor"
        title="Live sequence state"
        description="Each sequence now carries multiple steps plus explicit send policy settings."
      />
      <div className="mt-5 space-y-4">
        {props.sequences.length === 0 ? (
          <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4 text-sm text-muted-foreground">
            No sequences yet. Create one above, then enroll contacts from a
            contact workspace.
          </div>
        ) : (
          props.sequences.map((sequence) => (
            <div
              key={sequence.id}
              className="space-y-4 rounded-2xl border border-border/85 bg-background/75 px-4 py-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-foreground">
                    {sequence.name}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {sequence.description || "No description yet"}
                  </p>
                </div>
                <Badge
                  variant={
                    sequence.status === "active" ? "secondary" : "outline"
                  }
                >
                  {sequence.status}
                </Badge>
              </div>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-secondary/65 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Active
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {sequence.activeEnrollmentCount}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/65 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Paused
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {sequence.pausedEnrollmentCount}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/65 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Drafts
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {sequence.pendingApprovalCount}
                  </p>
                </div>
                <div className="rounded-xl bg-secondary/65 px-3 py-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Next due
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {formatDueAt(sequence.nextDueAt)}
                  </p>
                </div>
              </div>

              <form
                action={updateSequenceAction}
                className="grid gap-4 rounded-2xl border border-border/80 bg-card/70 px-4 py-4"
              >
                <input type="hidden" name="sequenceId" value={sequence.id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">Name</span>
                    <input
                      name="name"
                      defaultValue={sequence.name}
                      className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                      required
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">Daily cap</span>
                    <input
                      name="dailySendCap"
                      type="number"
                      min={1}
                      defaultValue={sequence.dailySendCap}
                      className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                    />
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">Window start</span>
                    <input
                      name="sendWindowStartHour"
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={sequence.sendWindowStartHour}
                      className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">Window end</span>
                    <input
                      name="sendWindowEndHour"
                      type="number"
                      min={0}
                      max={23}
                      defaultValue={sequence.sendWindowEndHour}
                      className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                    />
                  </label>
                </div>
                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">Description</span>
                  <textarea
                    name="description"
                    defaultValue={sequence.description ?? ""}
                    rows={2}
                    className="border-border/80 bg-background w-full rounded-2xl border px-3 py-3 outline-none"
                  />
                </label>
                <div className="flex justify-end">
                  <div className="flex flex-wrap gap-3">
                    {sequence.status === "active" ? (
                      <Button
                        formAction={pauseSequenceAction}
                        name="sequenceId"
                        value={sequence.id}
                        type="submit"
                        variant="outline"
                      >
                        Pause sequence
                      </Button>
                    ) : (
                      <Button
                        formAction={resumeSequenceAction}
                        name="sequenceId"
                        value={sequence.id}
                        type="submit"
                        variant="outline"
                      >
                        Resume sequence
                      </Button>
                    )}
                    <Button type="submit" variant="outline">
                      Save sequence settings
                    </Button>
                  </div>
                </div>
              </form>

              <div className="space-y-3">
                {sequence.steps.map((step) => (
                  <form
                    key={step.id}
                    action={updateSequenceStepAction}
                    className="space-y-3 rounded-2xl border border-border/80 bg-card/70 px-4 py-4"
                  >
                    <input type="hidden" name="stepId" value={step.id} />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">Step {step.position}</Badge>
                        <p className="text-sm font-medium text-foreground">
                          {step.title}
                        </p>
                      </div>
                      {sequence.steps.length > 1 ? (
                        <Button
                          formAction={deleteSequenceStepAction}
                          name="stepId"
                          value={step.id}
                          type="submit"
                          variant="outline"
                        >
                          Delete step
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                      <label className="space-y-2 text-sm">
                        <span className="text-muted-foreground">Title</span>
                        <input
                          name="title"
                          defaultValue={step.title}
                          className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                        />
                      </label>
                      <label className="space-y-2 text-sm">
                        <span className="text-muted-foreground">Delay days</span>
                        <input
                          name="delayDays"
                          type="number"
                          min={0}
                          defaultValue={step.delayDays}
                          className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                        />
                      </label>
                    </div>
                    <label className="space-y-2 text-sm">
                      <span className="text-muted-foreground">Subject</span>
                      <input
                        name="subjectTemplate"
                        defaultValue={step.subjectTemplate}
                        className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                        required
                      />
                    </label>
                    <label className="space-y-2 text-sm">
                      <span className="text-muted-foreground">Body</span>
                      <textarea
                        name="bodyTemplate"
                        defaultValue={step.bodyTemplate}
                        rows={6}
                        className="border-border/80 bg-background w-full rounded-2xl border px-3 py-3 font-mono text-sm outline-none"
                        required
                      />
                    </label>
                    <div className="flex justify-end">
                      <Button type="submit" variant="outline">
                        Save step
                      </Button>
                    </div>
                  </form>
                ))}
              </div>

              <form
                action={addSequenceStepAction}
                className="space-y-3 rounded-2xl border border-dashed border-border/85 bg-card/60 px-4 py-4"
              >
                <input type="hidden" name="sequenceId" value={sequence.id} />
                <p className="text-sm font-medium text-foreground">Add step</p>
                <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">Title</span>
                    <input
                      name="title"
                      placeholder={`Step ${sequence.steps.length + 1}`}
                      className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                    />
                  </label>
                  <label className="space-y-2 text-sm">
                    <span className="text-muted-foreground">Delay days</span>
                    <input
                      name="delayDays"
                      type="number"
                      min={0}
                      defaultValue={3}
                      className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                    />
                  </label>
                </div>
                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">Subject</span>
                  <input
                    name="subjectTemplate"
                    placeholder="Checking back in, {{first_name}}"
                    className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                    required
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">Body</span>
                  <textarea
                    name="bodyTemplate"
                    rows={5}
                    className="border-border/80 bg-background w-full rounded-2xl border px-3 py-3 font-mono text-sm outline-none"
                    required
                  />
                </label>
                <div className="flex justify-end">
                  <Button type="submit" variant="outline">
                    Add step
                  </Button>
                </div>
              </form>
            </div>
          ))
        )}
      </div>
    </DashboardPanel>
  );
}

function ApprovalQueuePanel(props: {
  approvals: Awaited<ReturnType<typeof listPendingOutboundApprovals>>;
}) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Approval queue"
        title="Due drafts waiting on you"
        description="Failed sends return here for retry. Queued sends remain subject to per-sequence send windows and per-account daily caps."
      />

      <div className="mt-5 space-y-4">
        {props.approvals.length === 0 ? (
          <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4 text-sm text-muted-foreground">
            No outbound items need attention right now. Enroll a contact in an
            active sequence, then let the worker generate the due draft.
          </div>
        ) : (
          props.approvals.map((draft) => {
            const diagnostics = outboundDiagnosticMetadata(draft.metadata);

            return (
              <form
                key={draft.id}
                action={approveOutboundDraftAction}
                className="space-y-4 rounded-2xl border border-border/85 bg-background/75 px-4 py-4"
              >
                <input type="hidden" name="messageId" value={draft.id} />
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-foreground">
                      {draft.contact?.displayName ?? "Unknown contact"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {draft.sequence?.name ?? "Ad hoc"} ·{" "}
                      {draft.contact?.primaryEmail ?? "No email"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge
                      variant={
                        draft.status === "failed"
                          ? "destructive"
                          : draft.status === "queued"
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {draft.status}
                    </Badge>
                    <Badge variant="secondary">
                      {draft.connectedAccount?.email ??
                        draft.connectedAccount?.provider ??
                        "No sender"}
                    </Badge>
                  </div>
                </div>

                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">Subject</span>
                  <input
                    name="subject"
                    defaultValue={draft.finalSubject}
                    className="border-border/80 bg-background h-11 w-full rounded-2xl border px-3 outline-none"
                    required
                  />
                </label>

                <label className="space-y-2 text-sm">
                  <span className="text-muted-foreground">Body</span>
                  <textarea
                    name="body"
                    defaultValue={draft.finalBody}
                    rows={10}
                    className="border-border/80 bg-background w-full rounded-2xl border px-3 py-3 font-mono text-sm outline-none"
                    required
                  />
                </label>

                {draft.lastError ? (
                  <div className="rounded-xl border border-destructive/20 bg-destructive/8 px-3 py-3 text-sm text-destructive">
                    {draft.lastError}
                  </div>
                ) : null}

                {diagnostics.blockedReason && draft.status === "queued" ? (
                  <div className="rounded-xl border border-amber-300/40 bg-amber-100/50 px-3 py-3 text-sm text-amber-900">
                    Blocked for now: {diagnostics.blockedReason}
                  </div>
                ) : null}

                {diagnostics.attemptCount > 0 ||
                diagnostics.deliveryDiagnostic ||
                diagnostics.copyRevision > 0 ||
                diagnostics.failureCategory ? (
                  <div className="rounded-xl border border-border/80 bg-secondary/60 px-3 py-3 text-sm text-muted-foreground">
                    Attempts {diagnostics.attemptCount}. Revision{" "}
                    {Math.max(diagnostics.copyRevision, 1)}.{" "}
                    {diagnostics.failureCategory
                      ? `Failure class: ${diagnostics.failureCategory}. `
                      : null}
                    {diagnostics.deliveryDiagnostic ??
                      diagnostics.deliveryState ??
                      "No provider diagnostic captured yet."}
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-muted-foreground text-sm">
                    Due {formatDueAt(draft.dueAt)}.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {draft.status === "failed" ? (
                      <Button
                        formAction={retryOutboundMessageAction}
                        name="messageId"
                        value={draft.id}
                        type="submit"
                        variant="outline"
                      >
                        Retry with current copy
                      </Button>
                    ) : null}
                    <Button
                      formAction={cancelOutboundMessageAction}
                      name="messageId"
                      value={draft.id}
                      type="submit"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                    <Button type="submit">
                      {draft.status === "queued"
                        ? "Save copy and keep queued"
                        : draft.status === "failed"
                          ? diagnostics.retryable
                            ? "Save copy and requeue"
                            : "Save revised copy and requeue"
                          : "Approve and queue send"}
                    </Button>
                  </div>
                </div>
              </form>
            );
          })
        )}
      </div>
    </DashboardPanel>
  );
}

export async function SequencesPageView({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const ownerUserId = await getPersistentOwnerUserId();
  const [approvals, sendAccounts, sequenceRows] = await Promise.all([
    listPendingOutboundApprovals(),
    listSendCapableAccountsForUser(ownerUserId),
    listSequencesOverview(),
  ]);
  const error =
    typeof searchParams.error === "string"
      ? decodeURIComponent(searchParams.error)
      : null;
  const feedback = feedbackMessage(searchParams);

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
      <div className="space-y-6">
        <SequencesHeader
          approvalsCount={approvals.length}
          error={error}
          feedback={feedback}
          sendAccounts={sendAccounts}
        />
        <CreateSequencePanel />
        <SequenceEditorPanel sequences={sequenceRows} />
      </div>
      <ApprovalQueuePanel approvals={approvals} />
    </div>
  );
}
