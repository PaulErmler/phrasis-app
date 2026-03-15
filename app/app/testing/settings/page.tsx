'use client';

import { Authenticated, AuthLoading } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { SettingsTest } from '@/components/testing/settings/SettingsTest';

export default function SettingsTestPage() {
  return (
    <>
      <AuthLoading>
        <div className="h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AuthLoading>
      <Authenticated>
        <SettingsTest />
      </Authenticated>
    </>
  );
}
