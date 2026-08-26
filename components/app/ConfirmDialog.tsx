'use client';

import type { ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Already-translated content; translation calls stay with the caller. */
  title: ReactNode;
  description: ReactNode;
  cancelLabel: ReactNode;
  confirmLabel: ReactNode;
  /** Runs on confirm; the dialog closes itself afterwards (Radix Action). */
  onConfirm: () => void;
  /** Destructive styling for the confirm button (deletes and the like). */
  destructive?: boolean;
  /** Disables both buttons while the confirmed action is in flight. */
  pending?: boolean;
  /** Extra classes for the title row (e.g. to lay out a leading icon). */
  titleClassName?: string;
  confirmTestId?: string;
}

/**
 * The standard confirm-before-acting dialog: title, description, cancel,
 * and a confirm action. One shared scaffold so the AlertDialog markup isn't
 * copy-pasted around every destructive action.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  destructive = false,
  pending,
  titleClassName,
  confirmTestId,
}: ConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className={titleClassName}>
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className={
              destructive
                ? buttonVariants({ variant: 'destructive' })
                : undefined
            }
            onClick={onConfirm}
            disabled={pending}
            data-testid={confirmTestId}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
