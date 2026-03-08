import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInWithPasswordAction } from "@/app/actions/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getCurrentUser, isOwnerModeEnabled } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign in | Kanbun",
  description: "Owner-mode sign in for the Kanbun workspace.",
};

const errorMessages: Record<string, string> = {
  "invalid-credentials": "The email or password is incorrect.",
  "missing-fields": "Email and password are both required.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!isOwnerModeEnabled()) {
    redirect("/");
  }

  const user = await getCurrentUser();

  if (user) {
    redirect("/");
  }

  const params = await searchParams;
  const errorKey = typeof params.error === "string" ? params.error : undefined;
  const errorMessage = errorKey ? errorMessages[errorKey] : null;

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="grid w-full max-w-5xl gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section className="border-border/80 rounded-[calc(var(--radius)*1.6)] border bg-[linear-gradient(145deg,color-mix(in_oklab,var(--card)_88%,white),color-mix(in_oklab,var(--accent)_18%,white))] p-8 sm:p-10">
          <div className="space-y-5">
            <Badge
              variant="outline"
              className="border-primary/25 bg-background/70 text-muted-foreground text-[11px] tracking-[0.22em] uppercase"
            >
              Owner mode
            </Badge>
            <div className="space-y-3">
              <p className="text-foreground font-serif text-5xl leading-none tracking-tight">
                Kanbun
              </p>
              <p className="text-muted-foreground max-w-xl text-base leading-7">
                Personal relationship work, organized into one calm operating
                surface. This first auth pass is intentionally owner-only and
                database-backed.
              </p>
            </div>
          </div>
        </section>

        <section className="border-border/80 bg-card rounded-[calc(var(--radius)*1.6)] border p-8 shadow-[0_20px_80px_-48px_color-mix(in_oklab,var(--foreground)_18%,transparent)] sm:p-10">
          <div className="space-y-6">
            <div className="space-y-2">
              <p className="text-muted-foreground text-[11px] tracking-[0.22em] uppercase">
                Sign in
              </p>
              <h1 className="text-foreground text-3xl font-semibold tracking-tight">
                Enter the workspace
              </h1>
              <p className="text-muted-foreground text-sm leading-6">
                Use the owner credentials seeded into the local database.
              </p>
            </div>

            <form action={signInWithPasswordAction} className="space-y-4">
              <div className="space-y-2">
                <label
                  className="text-foreground text-sm font-medium"
                  htmlFor="email"
                >
                  Email
                </label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="owner@example.com"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-foreground text-sm font-medium"
                  htmlFor="password"
                >
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  placeholder="••••••••"
                />
              </div>

              {errorMessage ? (
                <div className="border-destructive/20 bg-destructive/8 text-destructive rounded-2xl border px-4 py-3 text-sm">
                  {errorMessage}
                </div>
              ) : null}

              <Button type="submit" size="lg" className="w-full">
                Sign in
              </Button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
