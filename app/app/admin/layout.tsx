import { notFound } from 'next/navigation';
import { fetchAuthQuery } from '@/lib/auth-server';
import { api } from '@/convex/_generated/api';
import { SuspendSessionReplay } from '@/components/analytics/SuspendSessionReplay';

// Cosmetic gate for every /app/admin route — each admin query re-checks via
// requireAdmin on the server, so a spoofed render here would still show no
// data.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await fetchAuthQuery(api.admin.dashboard.isAdmin, {});
  if (!isAdmin) notFound();
  return (
    <>
      <SuspendSessionReplay />
      {children}
    </>
  );
}
