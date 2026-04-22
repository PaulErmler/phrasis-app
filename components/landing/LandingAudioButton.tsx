'use client';

import { Button } from '@/components/ui/button';
import { playLandingAudio } from '@/lib/landing/audio';
import { Volume2 } from 'lucide-react';

/**
 * Landing-only speaker button. When `url` is provided, the button plays the
 * pre-generated mp3 on click; otherwise it renders the same disabled
 * placeholder the page used to ship (so a missing manifest entry degrades
 * gracefully instead of blocking render).
 */
export function LandingAudioButton({
  url,
  language,
  showLabel = false,
}: {
  url?: string | null;
  language: string;
  showLabel?: boolean;
}) {
  const enabled = typeof url === 'string' && url.length > 0;
  const handleClick = () => {
    if (enabled) playLandingAudio(url);
  };

  if (showLabel) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!enabled}
        onClick={handleClick}
        className={
          enabled
            ? 'gap-1 text-muted-foreground hover:text-foreground'
            : 'gap-1 text-muted-foreground pointer-events-none'
        }
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
      disabled={!enabled}
      onClick={handleClick}
      className={
        enabled
          ? 'h-8 w-8 text-muted-foreground hover:text-foreground'
          : 'h-8 w-8 text-muted-foreground pointer-events-none'
      }
      aria-label={language}
    >
      <Volume2 className="h-4 w-4" />
    </Button>
  );
}
