import { AdminUserDetailView } from '@/components/admin/AdminUserDetailView';

// Admin gating lives in the segment layout (../../layout.tsx).
export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <AdminUserDetailView userId={userId} />;
}
