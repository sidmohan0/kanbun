import { updateCsvImportRowAction } from "@/app/actions/workflows";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ImportRowCardProps = {
  importId: string;
  isDraft: boolean;
  page: number;
  row: {
    contactId: string | null;
    id: string;
    normalizedCompany: string | null;
    normalizedEmail: string | null;
    normalizedName: string | null;
    normalizedTitle: string | null;
    overrideAction: "create" | "flag" | "skip" | "update" | null;
    overrideCompany: string | null;
    overrideEmail: string | null;
    overrideName: string | null;
    overrideTitle: string | null;
    proposedAction: "create" | "flag" | "skip" | "update";
    rowNumber: number;
    status:
      | "created"
      | "flagged"
      | "pending"
      | "processing"
      | "skipped"
      | "updated";
    warnings: string[];
  };
};

function rowStatusVariant(status: string) {
  if (status === "created" || status === "updated") {
    return "secondary";
  }

  if (status === "processing") {
    return "default";
  }

  if (status === "flagged") {
    return "destructive";
  }

  return "outline";
}

export function ImportRowCard({
  importId,
  isDraft,
  page,
  row,
}: ImportRowCardProps) {
  const actionValue = row.overrideAction ?? "__auto__";

  return (
    <div className="rounded-2xl border border-border/85 bg-background/75 px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Row {row.rowNumber}</p>
          <p className="text-sm text-muted-foreground">
            {row.normalizedName || row.normalizedEmail || "No mapped contact"}
          </p>
          <p className="text-sm text-muted-foreground">
            {row.contactId
              ? `Existing contact match: ${row.contactId}`
              : "No existing contact match"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{row.proposedAction}</Badge>
          <Badge variant={rowStatusVariant(row.status)}>{row.status}</Badge>
        </div>
      </div>

      {row.warnings.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {row.warnings.map((warning) => (
            <Badge key={`${row.id}-${warning}`} variant="outline">
              {warning}
            </Badge>
          ))}
        </div>
      ) : null}

      {isDraft ? (
        <form action={updateCsvImportRowAction} className="mt-4 space-y-3">
          <input type="hidden" name="importId" value={importId} />
          <input type="hidden" name="rowId" value={row.id} />
          <input type="hidden" name="page" value={page} />
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor={`name-${row.id}`}
              >
                Name
              </label>
              <Input
                id={`name-${row.id}`}
                name="name"
                defaultValue={row.overrideName ?? row.normalizedName ?? ""}
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor={`email-${row.id}`}
              >
                Email
              </label>
              <Input
                id={`email-${row.id}`}
                name="email"
                defaultValue={row.overrideEmail ?? row.normalizedEmail ?? ""}
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor={`company-${row.id}`}
              >
                Company
              </label>
              <Input
                id={`company-${row.id}`}
                name="company"
                defaultValue={
                  row.overrideCompany ?? row.normalizedCompany ?? ""
                }
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor={`title-${row.id}`}
              >
                Title
              </label>
              <Input
                id={`title-${row.id}`}
                name="title"
                defaultValue={row.overrideTitle ?? row.normalizedTitle ?? ""}
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-end">
            <div className="space-y-2">
              <label
                className="text-sm font-medium text-foreground"
                htmlFor={`action-${row.id}`}
              >
                Resolution
              </label>
              <select
                id={`action-${row.id}`}
                name="action"
                defaultValue={actionValue}
                className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm text-foreground"
              >
                <option value="__auto__">Auto detect</option>
                {!row.contactId ? <option value="create">Force create</option> : null}
                {row.contactId ? (
                  <option value="update">Update existing contact</option>
                ) : null}
                <option value="flag">Flag for review</option>
                <option value="skip">Skip row</option>
              </select>
            </div>
            <div className="rounded-xl border border-border/80 bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
              Draft changes are recomputed against the whole file, so duplicate
              detection and summary counts stay consistent.
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="outline">
              Save row changes
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
