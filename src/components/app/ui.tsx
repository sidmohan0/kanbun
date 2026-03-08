import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type DashboardPanelProps = {
  children: ReactNode;
  className?: string;
};

export function DashboardPanel({ children, className }: DashboardPanelProps) {
  return (
    <section
      className={cn(
        "border-border/85 bg-card rounded-[calc(var(--radius)*1.45)] border p-5 shadow-[0_12px_50px_-36px_color-mix(in_oklab,var(--foreground)_20%,transparent)] sm:p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
};

export function SectionHeading({
  eyebrow,
  title,
  description,
}: SectionHeadingProps) {
  return (
    <div className="mb-5 space-y-2">
      <p className="text-muted-foreground text-[11px] tracking-[0.2em] uppercase">
        {eyebrow}
      </p>
      <div className="space-y-1">
        <h2 className="text-foreground text-2xl font-semibold tracking-tight">
          {title}
        </h2>
        {description ? (
          <p className="text-muted-foreground max-w-2xl text-sm leading-6">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}

type MetricTileProps = {
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
};

export function MetricTile({ label, value, note, icon }: MetricTileProps) {
  return (
    <div className="border-border/80 bg-background/80 rounded-[calc(var(--radius)*1.05)] border p-4">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-xs tracking-[0.2em] uppercase">
          {label}
        </p>
        <div className="text-primary">{icon}</div>
      </div>
      <p className="text-foreground mt-3 text-3xl font-semibold tracking-tight">
        {value}
      </p>
      <p className="text-muted-foreground mt-2 text-sm leading-6">{note}</p>
    </div>
  );
}
