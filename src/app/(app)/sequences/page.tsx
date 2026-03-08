import type { Metadata } from "next";
import { DashboardPanel, SectionHeading } from "@/components/app/ui";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Sequences | Kanbun",
  description: "Manage reusable outreach sequences and review due steps.",
};

export default function SequencesPage() {
  return (
    <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
      <DashboardPanel>
        <SectionHeading
          eyebrow="Sequences"
          title="Reusable outreach with operator control"
          description="Manual review stays the default. The shell should communicate due work and blocked enrollments immediately."
        />
        <div className="text-muted-foreground space-y-3 text-sm">
          <div className="border-border/80 bg-background/75 rounded-2xl border px-4 py-4">
            Founder re-engagement · 12 active enrollments
          </div>
          <div className="border-border/80 bg-background/75 rounded-2xl border px-4 py-4">
            Advisor touchpoints · 5 active enrollments
          </div>
        </div>
      </DashboardPanel>

      <DashboardPanel>
        <SectionHeading
          eyebrow="Due next"
          title="What the sequence engine will need to show"
          description="This is a placeholder state for the first sequence queue."
        />
        <div className="space-y-3">
          {[
            "Alexandra Park · Step 2 draft due at 2:00 PM",
            "Mina Takahashi · Awaiting send approval",
            "Jonas Reid · Paused on reply signal",
          ].map((entry) => (
            <div
              key={entry}
              className="border-border/85 bg-background/75 flex items-center justify-between rounded-2xl border px-4 py-4"
            >
              <span className="text-muted-foreground text-sm">{entry}</span>
              <Badge variant="outline">Shell</Badge>
            </div>
          ))}
        </div>
      </DashboardPanel>
    </div>
  );
}
