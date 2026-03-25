'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleHelp, Mail, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

const SUPPORT_EMAIL = 'support@flexling.com';

export function HelpDialog({
  onRestartTutorial,
  supportOnly = false,
  children,
  triggerClassName,
  onOpen,
}: {
  onRestartTutorial?: () => void;
  /** Contact-only copy and actions; no tutorial messaging or restart button. */
  supportOnly?: boolean;
  /** Extra content rendered between the description and the footer buttons. */
  children?: React.ReactNode;
  /** Additional class names for the trigger button. */
  triggerClassName?: string;
  /** Called when the dialog opens. */
  onOpen?: () => void;
}) {
  const t = useTranslations('AppPage');
  const [open, setOpen] = useState(false);

  const handleOpenChange = (value: boolean) => {
    if (value) onOpen?.();
    setOpen(value);
  };

  const title = supportOnly
    ? t('help.supportOnly.title')
    : t('help.title');
  const description = supportOnly
    ? t('help.supportOnly.description')
    : t('help.description');

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className={`size-9 ${triggerClassName ?? ''}`}>
          <CircleHelp className="h-5 w-5" />
          <span className="sr-only">{title}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="top-[calc(3.5rem+1.5rem)] max-h-[calc(100dvh-3.5rem-1.5rem-1rem-env(safe-area-inset-bottom,0px))] translate-y-0 overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter className="flex !flex-row w-full gap-2 [&>*]:min-w-0">
          <Button variant="outline" className="flex-1" asChild>
            <a href={`mailto:${SUPPORT_EMAIL}`}>
              <Mail className="h-4 w-4 shrink-0" />
              {t('help.contactUs')}
            </a>
          </Button>
          {!supportOnly && onRestartTutorial && (
            <Button
              className="flex-1"
              onClick={() => {
                setOpen(false);
                setTimeout(() => onRestartTutorial(), 300);
              }}
            >
              <Play className="h-4 w-4 shrink-0" />
              {t('help.restartTutorial')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
