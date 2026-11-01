import type { Store } from "@kanbun/sync";

export type SheetsExport = { sheetId: number; title: string; values: (string | number)[][] }[];

/** Only public-team data crosses this boundary, including names resolved through relations. */
export function sheetsExport(store: Store, projectsEnabled: boolean): SheetsExport {
  const teams = new Map(
    store
      .list("team")
      .filter((t) => t.visibility === "public" && !t.retiredAt && !t.archivedAt)
      .map((t) => [t.id, t]),
  );
  const projects = new Map(
    store
      .list("project")
      .filter((p) => !p.trashed && store.list("projectTeam", { projectId: p.id }).some((t) => teams.has(t.teamId)))
      .map((p) => [p.id, p]),
  );
  const issues = store.list("issue").filter((i) => teams.has(i.teamId) && !i.trashed);
  const publicIssues = new Set(issues.map((i) => i.id));
  const person = (id: string | null) => (id ? (store.get("user", id)?.name ?? "") : "");
  const issueValues: (string | number)[][] = [
    [
      "ID",
      "Team",
      "Title",
      "Description",
      "Status",
      "Estimate",
      "Priority",
      "Project ID",
      "Project",
      "Creator",
      "Assignee",
      "Labels",
      "Cycle Number",
      "Cycle Name",
      "Cycle Start",
      "Cycle End",
      "Due Date",
      "Parent issue",
      "Project Milestone ID",
      "Project Milestone",
      "Created",
      "Updated",
      "Started",
      "Triaged",
      "Completed",
      "Canceled",
      "Archived",
    ],
  ];
  for (const i of issues.sort((a, b) => a.teamId.localeCompare(b.teamId) || a.number - b.number)) {
    const team = teams.get(i.teamId)!;
    const project = i.projectId ? projects.get(i.projectId) : undefined;
    const cycle = i.cycleId ? store.get("cycle", i.cycleId) : undefined;
    const safeCycle = cycle?.teamId === team.id ? cycle : undefined;
    const milestone = project && i.projectMilestoneId ? store.get("projectMilestone", i.projectMilestoneId) : undefined;
    const safeMilestone = milestone?.projectId === project?.id ? milestone : undefined;
    const parent = i.parentId && publicIssues.has(i.parentId) ? store.get("issue", i.parentId) : undefined;
    const labels = store
      .list("issueLabelLink", { issueId: i.id })
      .flatMap((l) => {
        const label = store.get("issueLabel", l.labelId);
        return label && (!label.teamId || label.teamId === team.id) ? [label.name] : [];
      })
      .sort()
      .join(", ");
    issueValues.push([
      `${team.key}-${i.number}`,
      team.name,
      i.title,
      i.description ?? "",
      store.get("workflowState", i.stateId)?.name ?? "",
      i.estimate ?? "",
      i.priority,
      project?.id ?? "",
      project?.name ?? "",
      person(i.creatorId),
      person(i.assigneeId),
      labels,
      safeCycle?.number ?? "",
      safeCycle?.name ?? "",
      safeCycle?.startsAt ?? "",
      safeCycle?.endsAt ?? "",
      i.dueDate ?? "",
      parent ? `${teams.get(parent.teamId)!.key}-${parent.number}` : "",
      safeMilestone?.id ?? "",
      safeMilestone?.name ?? "",
      i.createdAt,
      i.updatedAt,
      i.startedAt ?? "",
      i.triagedAt ?? "",
      i.completedAt ?? "",
      i.canceledAt ?? "",
      i.archivedAt ?? "",
    ]);
  }
  const projectValues: (string | number)[][] = [
    [
      "ID",
      "Name",
      "Description",
      "Status",
      "Priority",
      "Milestones",
      "Creator",
      "Lead",
      "Start Date",
      "Target Date",
      "Created",
      "Started",
      "Updated",
      "Completed",
      "Canceled",
      "Archived",
      "Teams",
      "Health",
    ],
  ];
  if (projectsEnabled)
    for (const p of [...projects.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      projectValues.push([
        p.id,
        p.name,
        p.description ?? "",
        store.get("projectStatus", p.statusId)?.name ?? "",
        p.priority,
        store
          .list("projectMilestone", { projectId: p.id })
          .filter((m) => !m.archivedAt)
          .map((m) => m.name)
          .join(", "),
        person(p.creatorId),
        person(p.leadId),
        p.startDate ?? "",
        p.targetDate ?? "",
        p.createdAt,
        p.startedAt ?? "",
        p.updatedAt,
        p.completedAt ?? "",
        p.canceledAt ?? "",
        p.archivedAt ?? "",
        store
          .list("projectTeam", { projectId: p.id })
          .flatMap((t) => (teams.has(t.teamId) ? [teams.get(t.teamId)!.name] : []))
          .sort()
          .join(", "),
        p.health ?? "",
      ]);
    }
  return [
    { sheetId: 0, title: "Issues", values: issueValues },
    { sheetId: 1, title: "Projects", values: projectValues },
  ];
}

/** Full owned-tab replacement clears deleted/private rows; stringValue never evaluates formulas. */
export function sheetsWriteRequests(data: SheetsExport) {
  return data.flatMap(({ sheetId, values }) => [
    {
      updateSheetProperties: {
        properties: { sheetId, gridProperties: { rowCount: values.length, columnCount: values[0]!.length } },
        fields: "gridProperties.rowCount,gridProperties.columnCount",
      },
    },
    {
      updateCells: {
        range: { sheetId },
        rows: values.map((row) => ({
          values: row.map((value) => ({
            userEnteredValue: typeof value === "number" ? { numberValue: value } : { stringValue: value },
          })),
        })),
        fields: "userEnteredValue",
      },
    },
  ]);
}
