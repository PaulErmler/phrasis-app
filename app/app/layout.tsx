import { redirect } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth-server';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authed = await isAuthenticated();
  if (!authed) {
    redirect('/auth/sign-in');
  }
  return <>{children}</>;
}
