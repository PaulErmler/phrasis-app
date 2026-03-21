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
}: {
  onRestartTutorial?: () => void;
  /** Contact-only copy and actions; no tutorial messaging or restart button. */
  supportOnly?: boolean;
}) {
  const t = useTranslations('AppPage');
  const [open, setOpen] = useState(false);

  const title = supportOnly
    ? t('help.supportOnly.title')
    : t('help.title');
  const description = supportOnly
    ? t('help.supportOnly.description')
    : t('help.description');

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="size-9">
          <CircleHelp className="h-5 w-5" />
          <span className="sr-only">{title}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
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
