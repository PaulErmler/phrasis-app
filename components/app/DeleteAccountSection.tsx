'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from 'convex/react';
import { toast } from 'sonner';
import { Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { api } from '@/convex/_generated/api';
import { authClient } from '@/lib/auth-client';

/**
 * Account deletion from settings. Required by App Store Guideline 5.1.1(v)
 * now that the app ships in the stores. Files a deletion request (support@
 * is emailed automatically, deletion follows within 30 days. See
 * convex/features/accountDeletion.ts) and signs the user out.
 */
export function DeleteAccountSection() {
  const t = useTranslations('AppPage.settings.deleteAccount');
  const requestDeletion = useMutation(api.features.accountDeletion.requestAccountDeletion);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    setBusy(true);
    try {
      await requestDeletion();
      toast.success(t('success'));
      await authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = '/';
          },
        },
      });
    } catch (err) {
      console.error('Account deletion request failed:', err);
      toast.error(t('error'));
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        className="w-full text-destructive hover:text-destructive"
        onClick={() => setOpen(true)}
      >
        <Trash2 className="h-4 w-4 mr-2" />
        {t('button')}
      </Button>

      <Dialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
        <DialogContent className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm">
          <DialogTitle className="font-bold text-xl px-6">
            {t('title')}
          </DialogTitle>
          <p className="px-6 mt-1 mb-2 text-muted-foreground">
            {t('description')}
          </p>
          <DialogFooter className="dialog-footer-bar">
            <Button
              size="sm"
              variant="ghost"
              className="font-medium min-w-20"
              onClick={() => setOpen(false)}
              disabled={busy}
            >
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="font-medium shadow transition min-w-20"
              onClick={handleDelete}
              disabled={busy}
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t('confirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
