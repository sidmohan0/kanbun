/**
 * ViewPreferencesValues, phase-1 subset (67 fields). Grows per phase;
 * unknown keys are stripped on write so older clients never break newer ones.
 */
import { z } from "zod";

const Bool = z.boolean().optional();
const Str = z.string().optional();
const StrList = z.array(z.string()).optional();

export const ISSUE_GROUPINGS = [
  "noGrouping",
  "status",
  "assignee",
  "priority",
  "project",
  "cycle",
  "label",
  "parent",
  "team",
] as const;
export const ISSUE_ORDERINGS = [
  "manual",
  "priority",
  "updatedAt",
  "createdAt",
  "dueDate",
  "status",
  "assignee",
  "title",
] as const;
export const LAYOUTS = ["list", "board"] as const;
export const SHOW_COMPLETED = ["none", "1d", "1w", "2w", "1m", "all"] as const;

export const viewPreferencesValues = z
  .object({
    // Issues list & board
    layout: z.enum(LAYOUTS).optional(),
    issueGrouping: z.enum(ISSUE_GROUPINGS).optional(),
    issueGroupingLabelGroupId: Str,
    issueSubGrouping: z.enum(ISSUE_GROUPINGS).optional(),
    issueSubGroupingLabelGroupId: Str,
    issueNesting: z.enum(["flat", "nested", "parentsOnly"]).optional(),
    viewOrdering: z.enum(ISSUE_ORDERINGS).optional(),
    viewOrderingDirection: z.enum(["asc", "desc"]).optional(),
    groupOrderingMode: z.enum(["default", "manual", "alphabetical"]).optional(),
    columnOrderBoard: StrList,
    columnOrderList: StrList,
    hiddenColumns: StrList,
    hiddenGroupsList: StrList,
    hiddenRows: StrList,
    closedIssuesOrderedByRecency: Bool,
    showCompletedIssues: z.enum(SHOW_COMPLETED).optional(),
    showArchivedItems: Bool,
    showEmptyGroups: Bool,
    showEmptyGroupsBoard: Bool,
    showEmptyGroupsList: Bool,
    showEmptySubGroups: Bool,
    showEmptySubGroupsBoard: Bool,
    showEmptySubGroupsList: Bool,
    showParents: Bool,
    showSubIssues: Bool,
    showSubTeamIssues: Bool,
    showSupervisedIssues: Bool,
    openInSplitView: Bool,
    fieldAssignee: Bool,
    fieldDateArchived: Bool,
    fieldDateCreated: Bool,
    fieldDateMyActivity: Bool,
    fieldDateUpdated: Bool,
    fieldDueDate: Bool,
    fieldEstimate: Bool,
    fieldId: Bool,
    fieldLabels: Bool,
    fieldLinkCount: Bool,
    fieldPriority: Bool,
    fieldStatus: Bool,
    fieldTimeInCurrentStatus: Bool,
    // Inbox
    inboxViewGrouping: z.enum(["noGrouping", "issue", "project", "date"]).optional(),
    inboxViewOrdering: z.enum(["createdAt", "updatedAt"]).optional(),
    showReadItems: Bool,
    showSnoozedItems: Bool,
    showOnlySnoozedItems: Bool,
    showUnreadItemsFirst: Bool,
    // Teams & members
    teamViewOrdering: Str,
    teamFieldCycle: Bool,
    teamFieldDateCreated: Bool,
    teamFieldDateUpdated: Bool,
    teamFieldIdentifier: Bool,
    teamFieldMembers: Bool,
    teamFieldMembership: Bool,
    teamFieldOwner: Bool,
    teamFieldProjects: Bool,
    memberFieldJoined: Bool,
    memberFieldStatus: Bool,
    memberFieldTeams: Bool,
    workspaceMembersViewOrdering: Str,
    // Views list
    customViewsOrdering: Str,
    customViewFieldDateCreated: Bool,
    customViewFieldDateUpdated: Bool,
    customViewFieldOwner: Bool,
    customViewFieldVisibility: Bool,
    // Search
    searchResultType: z.enum(["all", "issue", "project", "document", "comment"]).optional(),
    searchViewOrdering: Str,
  })
  .strip();

export type ViewPreferencesValues = z.infer<typeof viewPreferencesValues>;

export const DEFAULT_ISSUE_VIEW: ViewPreferencesValues = {
  layout: "list",
  issueGrouping: "status",
  viewOrdering: "priority",
  viewOrderingDirection: "desc",
  showCompletedIssues: "1w",
  showSubIssues: true,
  showEmptyGroups: false,
  fieldId: true,
  fieldPriority: true,
  fieldStatus: true,
  fieldLabels: true,
  fieldAssignee: true,
  fieldDateCreated: true,
};
