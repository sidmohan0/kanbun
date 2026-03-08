import { uploadCsvImportAction } from "@/app/actions/workflows";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ImportUploadPanelProps = {
  errorMessage: string | null;
  queued: boolean;
  updated: boolean;
};

export function ImportUploadPanel({
  errorMessage,
  queued,
  updated,
}: ImportUploadPanelProps) {
  return (
    <DashboardPanel>
      <SectionHeading
        eyebrow="Imports"
        title="The first trust surface"
        description="Upload a CSV into a review draft first, inspect the detected mapping and row outcomes, then confirm before Kanbun writes canonical contacts."
      />
      <form action={uploadCsvImportAction} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor="label">
            Import label
          </label>
          <Input
            id="label"
            name="label"
            placeholder="Founder Summit contacts"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground" htmlFor="file">
            CSV file
          </label>
          <Input id="file" name="file" type="file" accept=".csv,text/csv" />
        </div>
        {errorMessage ? (
          <div className="rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        ) : null}
        {queued ? (
          <div className="rounded-2xl border border-border/80 bg-primary/8 px-4 py-3 text-sm text-foreground">
            Import queued for the worker runtime. Refresh the page to watch row
            statuses settle from pending into created or updated.
          </div>
        ) : null}
        {updated ? (
          <div className="rounded-2xl border border-border/80 bg-secondary/80 px-4 py-3 text-sm text-foreground">
            Draft preview updated.
          </div>
        ) : null}
        <Button type="submit" className="w-full">
          Upload for preview
        </Button>
      </form>
      <div className="mt-5 rounded-2xl border border-border/85 bg-background/75 px-4 py-4 text-sm leading-6 text-muted-foreground">
        The CSV flow now supports file fingerprinting, draft remapping, row
        edits, include or skip controls, paginated review, downloadable flagged
        reports, and dedicated worker processing after confirm.
      </div>
    </DashboardPanel>
  );
}
