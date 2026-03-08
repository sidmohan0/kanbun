"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellDot,
  BookUser,
  ClipboardList,
  FileUp,
  GitMerge,
  Home,
  Menu,
  Search,
  Settings2,
  Sparkles,
  Workflow,
} from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/", label: "Home", icon: Home },
  { href: "/contacts", label: "Contacts", icon: BookUser },
  { href: "/reviews", label: "Reviews", icon: GitMerge },
  { href: "/sequences", label: "Sequences", icon: Workflow },
  { href: "/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/imports", label: "Imports", icon: FileUp },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

type AppShellProps = {
  children: React.ReactNode;
  ownerModeEnabled: boolean;
  user: {
    email: string;
    name: string | null;
    role: "owner" | "disabled";
  };
};

function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1.5">
      {navigation.map(({ href, label, icon: Icon }) => {
        const active =
          href === "/" ? pathname === href : pathname.startsWith(href);

        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-[0_10px_30px_-18px_color-mix(in_oklab,var(--primary)_72%,transparent)]"
                : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({ children, ownerModeEnabled, user }: AppShellProps) {
  const initials = (user.name ?? user.email).slice(0, 2).toUpperCase();

  return (
    <div className="bg-background min-h-screen">
      <div className="kanbun-shell-grid mx-auto grid min-h-screen max-w-[1680px]">
        <aside className="border-sidebar-border bg-sidebar hidden border-r px-5 py-6 lg:flex lg:flex-col">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-sidebar-foreground font-serif text-3xl leading-none tracking-tight">
                Kanbun
              </p>
              <p className="text-muted-foreground text-xs tracking-[0.22em] uppercase">
                Relationship operating system
              </p>
            </div>
            <Sparkles className="text-primary size-4" />
          </div>

          <Separator className="my-6" />

          <NavLinks />

          <div className="border-sidebar-border bg-background/70 mt-auto space-y-4 rounded-[calc(var(--radius)*1.15)] border p-4">
            <div className="flex items-center justify-between">
              <p className="text-sidebar-foreground text-sm font-medium">
                System pulse
              </p>
              <Badge variant="secondary" className="bg-primary/10 text-primary">
                Stable
              </Badge>
            </div>
            <div className="text-muted-foreground space-y-2 text-sm">
              <p>2 inbox connectors healthy</p>
              <p>1 import requires review</p>
              <p>4 sends waiting on approval</p>
            </div>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="border-border/70 bg-background/85 sticky top-0 z-30 border-b backdrop-blur-xl">
            <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
              <Sheet>
                <SheetTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon-sm"
                      className="lg:hidden"
                    />
                  }
                >
                  <Menu className="size-4" />
                </SheetTrigger>
                <SheetContent side="left" className="bg-sidebar w-[18rem] px-0">
                  <SheetTitle className="sr-only">Navigation</SheetTitle>
                  <div className="space-y-6 px-4 py-6">
                    <div className="space-y-1">
                      <p className="text-sidebar-foreground font-serif text-3xl leading-none tracking-tight">
                        Kanbun
                      </p>
                      <p className="text-muted-foreground text-xs tracking-[0.22em] uppercase">
                        Relationship operating system
                      </p>
                    </div>
                    <NavLinks />
                  </div>
                </SheetContent>
              </Sheet>

              <div className="relative hidden max-w-md flex-1 items-center sm:flex">
                <Search className="text-muted-foreground pointer-events-none absolute left-3 size-4" />
                <Input
                  aria-label="Search contacts"
                  placeholder="Search by name or email"
                  className="border-border/80 bg-card h-11 rounded-2xl pl-10 text-sm shadow-none"
                />
              </div>

              <div className="ml-auto flex items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-primary/25 bg-primary/8 text-primary hidden rounded-full px-3 py-1 sm:inline-flex"
                >
                  4 approvals due
                </Badge>
                {ownerModeEnabled ? (
                  <form action={signOutAction}>
                    <Button
                      variant="outline"
                      size="sm"
                      className="hidden sm:inline-flex"
                    >
                      Sign out
                    </Button>
                  </form>
                ) : (
                  <Badge
                    variant="outline"
                    className="hidden rounded-full px-3 py-1 sm:inline-flex"
                  >
                    Local bypass
                  </Badge>
                )}
                <Button variant="outline" size="icon-sm">
                  <BellDot className="size-4" />
                </Button>
                <Avatar className="border-border/80 size-9 border">
                  <AvatarFallback className="bg-secondary text-secondary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </div>
            </div>
          </header>

          <main className="px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        </div>
      </div>
    </div>
  );
}
