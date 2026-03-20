import { AppLoadingSplash } from '@/components/LogoSpinner';

export default function Loading() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <AppLoadingSplash />
    </div>
  );
}
