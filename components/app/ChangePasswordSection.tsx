'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { KeyRound, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { authClient } from '@/lib/auth-client';

/**
 * Password management in settings.
 *
 * - Credential accounts get a change-password dialog (current + new
 *   password; other sessions are revoked on success — the standard "log
 *   out my other devices" hardening).
 * - Google/Apple-only accounts have no password to change; they get a
 *   "set a password" action instead, which emails the (rate-limited)
 *   reset link — completing it attaches a credential account so email +
 *   password login works alongside the social login.
 */
export function ChangePasswordSection({ email }: { email: string | undefined }) {
  const t = useTranslations('AppPage.settings.password');
  // undefined = still loading; renders nothing until resolved to avoid a
  // change→set button flash.
  const [hasCredential, setHasCredential] = useState<boolean | undefined>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    let cancelled = false;
    authClient
      .listAccounts()
      // Explicit structural type: better-auth's inferred client types have
      // proven environment-sensitive (the fresh Docker install's `next build`
      // degraded this callback param to an implicit any and failed the
      // deploy typecheck, while local tsc inferred it fine).
      .then(({ data }: { data: Array<{ providerId: string }> | null }) => {
        if (cancelled) return;
        setHasCredential(
          (data ?? []).some((account) => account.providerId === 'credential'),
        );
      })
      .catch(() => {
        // Leave undefined — the section simply doesn't render.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast.error(t('tooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('mismatch'));
      return;
    }
    setBusy(true);
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      // Best practice: a password change logs out every other device.
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (error) {
      toast.error(t('error'));
      return;
    }
    toast.success(t('success'));
    resetForm();
    setOpen(false);
  };

  const handleSetPassword = async () => {
    if (!email) return;
    setBusy(true);
    // Reuses the password-reset flow: the emailed link opens
    // /auth/reset-password, and saving there creates the credential
    // account. Rate-limited server-side (authEmail bucket).
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: '/auth/reset-password',
    });
    setBusy(false);
    if (error) {
      toast.error(t('setEmailError'));
      return;
    }
    toast.success(t('setEmailSent'));
  };

  if (hasCredential === undefined) return null;

  if (!hasCredential) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t('setDescription')}</p>
        <Button
          variant="outline"
          className="w-full sm:w-auto"
          onClick={handleSetPassword}
          disabled={busy || !email}
          data-testid="settings-set-password"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <KeyRound className="h-4 w-4" />
          )}
          {t('setButton')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        className="w-full sm:w-auto"
        onClick={() => setOpen(true)}
        data-testid="settings-change-password"
      >
        <KeyRound className="h-4 w-4" />
        {t('changeButton')}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          if (!next) resetForm();
          setOpen(next);
        }}
      >
        <DialogContent className="p-0 pt-4 gap-0 text-foreground overflow-hidden text-sm">
          <DialogTitle className="font-bold text-xl px-6">
            {t('title')}
          </DialogTitle>
          <p className="px-6 mt-1 text-muted-foreground">{t('description')}</p>
          <form
            className="px-6 py-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleChangePassword();
            }}
          >
            {/* Helps password managers associate the change with the account. */}
            <input
              type="email"
              autoComplete="username"
              value={email ?? ''}
              readOnly
              hidden
            />
            <div className="space-y-2">
              <Label htmlFor="current-password">{t('current')}</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={busy}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">{t('new')}</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={busy}
                required
                minLength={8}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">{t('confirm')}</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={busy}
                required
                minLength={8}
              />
            </div>
            {/* Hidden submit so Enter submits the form; the visible action
                lives in the footer bar below. */}
            <button type="submit" hidden />
          </form>
          <DialogFooter className="dialog-footer-bar">
            <Button
              size="sm"
              variant="ghost"
              className="font-medium min-w-20"
              onClick={() => {
                resetForm();
                setOpen(false);
              }}
              disabled={busy}
            >
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              className="font-medium shadow transition min-w-20"
              onClick={() => void handleChangePassword()}
              disabled={
                busy || !currentPassword || !newPassword || !confirmPassword
              }
              data-testid="settings-change-password-save"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t('save')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
