'use client';

import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { openPwaInstallDialog } from './open-pwa-install-dialog';

type ButtonProps = React.ComponentProps<typeof Button>;

/**
 * Client button that opens the global PWA install dialog (see PWAInstallGlobal).
 */
export function PwaInstallTrigger({
  className,
  onClick,
  children,
  ...props
}: ButtonProps) {
  return (
    <Button
      type="button"
      className={cn(className)}
      onClick={(e) => {
        onClick?.(e);
        openPwaInstallDialog();
      }}
      {...props}
    >
      {children}
    </Button>
  );
}

/**
 * FAQ-sized outline install control (label is not localized yet).
 */
export function PWAInstallButton() {
  return (
    <PwaInstallTrigger variant="outline" size="sm" className="gap-2">
      <Download className="w-4 h-4" />
      Install Flexling
    </PwaInstallTrigger>
  );
}
