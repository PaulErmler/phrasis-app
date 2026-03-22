'use client';

import { Button } from '@/components/ui/button';
import { Volume2 } from 'lucide-react';

/**
 * Landing-only: shows the same speaker icon as the app when there is no audio URL,
 * instead of a loading spinner (demo has no real audio).
 */
export function LandingAudioButton({
  language,
  showLabel = false,
}: {
  url?: null;
  language: string;
  showLabel?: boolean;
}) {
  if (showLabel) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        className="gap-1 text-muted-foreground pointer-events-none"
        aria-label={language}
      >
        <Volume2 className="h-3 w-3" />
        <span className="text-xs">{language}</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      disabled
      className="h-8 w-8 text-muted-foreground pointer-events-none"
      aria-label={language}
    >
      <Volume2 className="h-4 w-4" />
    </Button>
  );
}
