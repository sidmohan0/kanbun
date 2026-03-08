import { AppShell } from "@/components/app/app-shell";
import { isOwnerModeEnabled, requireUser } from "@/lib/auth";

export default async function ProtectedAppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUser();

  return (
    <AppShell ownerModeEnabled={isOwnerModeEnabled()} user={user}>
      {children}
    </AppShell>
  );
}
