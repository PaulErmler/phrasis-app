'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CircleCheck,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Star,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export interface CardActionsMenuProps {
  isFavorite: boolean;
  isMastered?: boolean;
  isHidden?: boolean;
  onFavorite: () => void;
  onMaster: () => void;
  onHide: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Tailwind size classes for the trigger + indicator buttons. */
  triggerClassName?: string;
  /** Tailwind size for the icons inside the buttons. */
  triggerIconClassName?: string;
}

export function CardActionsMenu({
  isFavorite,
  isMastered = false,
  isHidden = false,
  onFavorite,
  onMaster,
  onHide,
  onEdit,
  onDelete,
  triggerClassName = 'h-8 w-8',
  triggerIconClassName = 'h-4 w-4',
}: CardActionsMenuProps) {
  const t = useTranslations('LearningMode');
  // Controlled so the trigger only opens on a true tap (onClick fires after
  // pointerup with no significant movement). Radix's default behaviour opens
  // on pointerdown, which fires the moment a finger first lands on the
  // button — so on mobile, a scroll that starts on the button pops the menu
  // open. Suppressing pointerdown and toggling via click avoids that.
  const [open, setOpen] = useState(false);

  // Imperative open/close path used by the onboarding tutorial. We can't
  // reliably drive Radix's controlled state from the outside by clicking
  // the trigger button — the trigger has both an `onPointerDown` that
  // preventDefaults Radix's own open path AND an `onClick` that toggles
  // our `setOpen`, and event composition through `DropdownMenuTrigger`'s
  // `asChild` clone is fragile (programmatic `.click()` doesn't always
  // produce a state flip). Listening for explicit window events from the
  // tutorial gives us a deterministic channel that doesn't depend on any
  // of that.
  //
  // Visibility guard: more than one CardActionsMenu can be mounted at the
  // same time (e.g. during a card-advance slide where the previous card is
  // still in the DOM during its exit animation). Each instance listens on
  // window, so without a guard ALL of them would `setOpen(true)` — the
  // offscreen one would then render its dropdown at the default origin
  // (top-left of the viewport) because Radix anchors positioning to a
  // trigger that's no longer in flow.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isTriggerVisible = () => {
      const el = triggerRef.current;
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return false;
      // A previous card sliding out of view still has non-zero rect width
      // and height — it's just translated off-viewport. Require the
      // trigger to actually overlap the viewport so we only open the
      // on-screen instance.
      if (typeof window === 'undefined') return true;
      return (
        rect.right > 0 &&
        rect.left < window.innerWidth &&
        rect.bottom > 0 &&
        rect.top < window.innerHeight
      );
    };
    const onOpen = () => {
      if (!isTriggerVisible()) return;
      setOpen(true);
    };
    const onClose = () => {
      // Always honor close; pinning the guard to the visible instance
      // would leave the offscreen one stuck open if it had somehow opened.
      setOpen(false);
    };
    window.addEventListener('phrasis-onboarding-open-card-actions', onOpen);
    window.addEventListener('phrasis-onboarding-close-card-actions', onClose);
    return () => {
      window.removeEventListener('phrasis-onboarding-open-card-actions', onOpen);
      window.removeEventListener('phrasis-onboarding-close-card-actions', onClose);
    };
  }, []);

  return (
    <div className="flex items-center">
      {isFavorite && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onFavorite}
              aria-label={t('actions.favorite')}
              className={`${triggerClassName} text-favorite hover:text-favorite/80 hover:bg-favorite/10`}
            >
              <Star className={`${triggerIconClassName} fill-current`} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('actions.favorite')}</TooltipContent>
        </Tooltip>
      )}
      {isMastered && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onMaster}
              aria-label={t('actions.unmaster')}
              className={`${triggerClassName} text-success hover:text-success/80 hover:bg-success/10`}
            >
              <CircleCheck className={triggerIconClassName} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('actions.unmaster')}</TooltipContent>
        </Tooltip>
      )}
      {isHidden && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={onHide}
              aria-label={t('actions.unhide')}
              className={`${triggerClassName} text-destructive hover:text-destructive/80 hover:bg-destructive/10`}
            >
              <EyeOff className={triggerIconClassName} />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('actions.unhide')}</TooltipContent>
        </Tooltip>
      )}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon"
            aria-label={t('actions.more')}
            className={`${triggerClassName} text-muted-foreground hover:text-foreground hover:bg-muted`}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => setOpen((v) => !v)}
            data-coachmark-anchor="card-actions"
            data-tutorial="card-actions"
          >
            <MoreHorizontal className={triggerIconClassName} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[10rem]">
          {onEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              <span>{t('actions.edit')}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={onFavorite}>
            <Star className={isFavorite ? 'text-favorite fill-current' : undefined} />
            <span>{t('actions.favorite')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onMaster}>
            <CircleCheck className={isMastered ? 'text-success' : undefined} />
            <span>{isMastered ? t('actions.unmaster') : t('actions.master')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onHide}>
            <EyeOff className={isHidden ? 'text-destructive' : undefined} />
            <span>{isHidden ? t('actions.unhide') : t('actions.hide')}</span>
          </DropdownMenuItem>
          {onDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                <Trash2 />
                <span>{t('actions.delete')}</span>
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
