'use client';

import { RedirectToSignIn } from '@daveyplate/better-auth-ui';
import { Authenticated } from 'convex/react';
import { SettingsTest } from '@/components/testing/settings/SettingsTest';

export default function SettingsTestPage() {
  return (
    <>
      <RedirectToSignIn />
      <Authenticated>
        <SettingsTest />
      </Authenticated>
    </>
  );
}
