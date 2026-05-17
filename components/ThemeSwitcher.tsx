'use client';

import * as React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export function ThemeSwitcher({ className }: { className?: string }) {
  const { setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const t = useTranslations('Theme');

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Defer Radix DropdownMenu until after mount to avoid hydration mismatch
  // (Radix generates different IDs on server vs client)
  if (!mounted) {
    return (
      <div
        className={cn(
          'relative inline-flex items-center justify-center size-9 rounded-md',
          className,
        )}
        aria-hidden
      >
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="sr-only">{t('toggle')}</span>
      </div>
    );
  }

  return (
    // `modal={false}` keeps radix from locking body scroll while the menu is
    // open. The default `modal={true}` removes the scrollbar via
    // `react-remove-scroll-bar` and compensates the body with `padding-right`,
    // which shifts every non-fixed element by ~15px on every open/close (and
    // shifts a fixed header by the same amount because it isn't compensated).
    // A theme picker doesn't need focus-trap or scroll-lock semantics.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn('size-9', className)}
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">{t('toggle')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="mr-2 size-4" /> {t('light')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="mr-2 size-4" /> {t('dark')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="mr-2 size-4" /> {t('system')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
