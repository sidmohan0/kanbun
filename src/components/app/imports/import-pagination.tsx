import Link from "next/link";

type ImportPaginationProps = {
  importId: string;
  page: number;
  totalPages: number;
};

export function ImportPagination({
  importId,
  page,
  totalPages,
}: ImportPaginationProps) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border/85 bg-background/75 px-4 py-3">
      <p className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <Link
          href={`/imports?import=${importId}&page=${Math.max(1, page - 1)}`}
          aria-disabled={page <= 1}
          className={[
            "inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted",
            page <= 1 ? "pointer-events-none opacity-50" : "",
          ].join(" ")}
        >
          Previous
        </Link>
        <Link
          href={`/imports?import=${importId}&page=${Math.min(totalPages, page + 1)}`}
          aria-disabled={page >= totalPages}
          className={[
            "inline-flex h-7 items-center justify-center rounded-[min(var(--radius-md),12px)] border border-border bg-background px-2.5 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted",
            page >= totalPages ? "pointer-events-none opacity-50" : "",
          ].join(" ")}
        >
          Next
        </Link>
      </div>
    </div>
  );
}
