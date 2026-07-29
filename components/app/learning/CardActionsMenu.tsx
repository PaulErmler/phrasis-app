'use client';

import {
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from 'react';
import { useTranslations } from 'next-intl';
import {
  CircleCheck,
  EyeOff,
  Flag,
  Lock,
  MoreHorizontal,
  Pencil,
  Pin,
  RefreshCw,
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
import {
  DEFAULT_PINNED_CARD_ACTIONS,
  MAX_PINNED_CARD_ACTIONS,
  normalizePinnedCardActions,
  type PinnableCardAction,
} from '@/lib/cardActions';

export interface ActionQuotaState {
  /** Remaining usage. `unlimited` overrides this. */
  balance: number;
  /** When true the action is treated as having no cap. */
  unlimited?: boolean;
}

export interface CardActionsMenuProps {
  isFavorite: boolean;
  isMastered?: boolean;
  isHidden?: boolean;
  onFavorite: () => void;
  onMaster: () => void;
  onHide: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onFlag?: () => void;
  onRegenerateAudio?: () => void;
  /** Ordered list of actions promoted onto the card surface. */
  pinnedActions?: readonly string[];
  /** Persist the user's new pin order. Required to enable per-row pin toggles. */
  onUpdatePinnedActions?: (actions: PinnableCardAction[]) => void;
  /**
   * Per-action quota state. When `balance === 0 && !unlimited`, the action
   * renders disabled with a "0 left" badge and the click is suppressed. Low
   * balances surface a small "N left" badge as a warning. Actions without
   * an entry (or `unlimited: true`) render normally.
   */
  quotaState?: Partial<Record<PinnableCardAction, ActionQuotaState>>;
  /** Tailwind size classes for the trigger + indicator buttons. */
  triggerClassName?: string;
  /** Tailwind size for the icons inside the buttons. */
  triggerIconClassName?: string;
}

type ActionKey = PinnableCardAction;

interface ActionConfig {
  key: ActionKey;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  /** Surface tint when the action's state is "active" (favorite, mastered, hidden). */
  activeTone?: 'favorite' | 'success' | 'destructive';
  /** Whether this action is in its active state. */
  isActive: boolean;
  onClick: () => void;
  /** Hidden when the parent didn't wire a callback (mirrors edit/delete gating). */
  available: boolean;
  /** Quota state for this action — drives disabled + badge rendering. */
  quota?: ActionQuotaState;
}

/** Show a "N left" warning badge once the balance drops to this number. */
const LOW_QUOTA_THRESHOLD = 3;

export function CardActionsMenu({
  isFavorite,
  isMastered = false,
  isHidden = false,
  onFavorite,
  onMaster,
  onHide,
  onEdit,
  onDelete,
  onFlag,
  onRegenerateAudio,
  pinnedActions,
  onUpdatePinnedActions,
  quotaState,
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

  const normalizedPins = useMemo<PinnableCardAction[]>(
    () => normalizePinnedCardActions(pinnedActions),
    [pinnedActions],
  );

  const actions = useMemo<Record<ActionKey, ActionConfig>>(() => {
    const fav: ActionConfig = {
      key: 'favorite',
      label: t('actions.favorite'),
      Icon: Star,
      activeTone: 'favorite',
      isActive: isFavorite,
      onClick: onFavorite,
      available: true,
      quota: quotaState?.favorite,
    };
    const master: ActionConfig = {
      key: 'master',
      label: isMastered ? t('actions.unmaster') : t('actions.master'),
      Icon: CircleCheck,
      activeTone: 'success',
      isActive: isMastered,
      onClick: onMaster,
      available: true,
      quota: quotaState?.master,
    };
    const hide: ActionConfig = {
      key: 'hide',
      label: isHidden ? t('actions.unhide') : t('actions.hide'),
      Icon: EyeOff,
      activeTone: 'destructive',
      isActive: isHidden,
      onClick: onHide,
      available: true,
      quota: quotaState?.hide,
    };
    const edit: ActionConfig = {
      key: 'edit',
      label: t('actions.edit'),
      Icon: Pencil,
      isActive: false,
      onClick: onEdit ?? (() => undefined),
      available: !!onEdit,
      quota: quotaState?.edit,
    };
    const regen: ActionConfig = {
      key: 'regenerateAudio',
      label: t('actions.regenerateAudio'),
      Icon: RefreshCw,
      isActive: false,
      onClick: onRegenerateAudio ?? (() => undefined),
      available: !!onRegenerateAudio,
      quota: quotaState?.regenerateAudio,
    };
    const flag: ActionConfig = {
      key: 'flag',
      label: t('actions.flag'),
      Icon: Flag,
      isActive: false,
      onClick: onFlag ?? (() => undefined),
      available: !!onFlag,
      quota: quotaState?.flag,
    };
    return { favorite: fav, master, hide, edit, regenerateAudio: regen, flag };
  }, [
    isFavorite,
    isHidden,
    isMastered,
    onEdit,
    onFavorite,
    onFlag,
    onHide,
    onMaster,
    onRegenerateAudio,
    quotaState,
    t,
  ]);

  const isQuotaDepleted = (cfg: ActionConfig) =>
    !!cfg.quota && !cfg.quota.unlimited && cfg.quota.balance <= 0;
  const isQuotaLow = (cfg: ActionConfig) =>
    !!cfg.quota &&
    !cfg.quota.unlimited &&
    cfg.quota.balance > 0 &&
    cfg.quota.balance <= LOW_QUOTA_THRESHOLD;

  const pinnedKeys = normalizedPins.filter((key) => actions[key].available);
  // `pinnedKeys` is a fresh array every render so memoising the Set buys
  // nothing — and the Set is at most MAX_PINNED_CARD_ACTIONS entries.
  const pinnedSet = new Set(pinnedKeys);

  // Toggle a pin without dismissing the dropdown — pinning is a side gesture,
  // not the primary action. The pin icon is its own button, so we stop the
  // event from bubbling into the row's onSelect (which would fire the
  // underlying action) and call updatePinnedActions directly.
  const togglePin = (key: PinnableCardAction) => {
    if (!onUpdatePinnedActions) return;
    let next: PinnableCardAction[];
    if (pinnedSet.has(key)) {
      next = pinnedKeys.filter((k) => k !== key);
      if (next.length === 0) {
        next = [...DEFAULT_PINNED_CARD_ACTIONS];
      }
    } else {
      // Source-of-truth max guard: the pin button uses `aria-disabled` (not
      // the `disabled` attribute) so the tooltip still fires when the user
      // hovers a full slot. Because aria-disabled does NOT block keyboard
      // activation or pointer events, this check is what actually prevents
      // over-pinning — do not remove it just because the DOM appears disabled.
      if (pinnedKeys.length >= MAX_PINNED_CARD_ACTIONS) return;
      next = [...pinnedKeys, key];
    }
    onUpdatePinnedActions(next);
  };

  const toneClassesForButton = (tone: ActionConfig['activeTone']) => {
    switch (tone) {
    case 'favorite':
      return 'text-favorite hover:text-favorite/80 hover:bg-favorite/10';
    case 'success':
      return 'text-success hover:text-success/80 hover:bg-success/10';
    case 'destructive':
      return 'text-destructive hover:text-destructive/80 hover:bg-destructive/10';
    default:
      return 'text-muted-foreground hover:text-foreground hover:bg-muted';
    }
  };

  const toneClassForMenuIcon = (tone: ActionConfig['activeTone']) => {
    switch (tone) {
    case 'favorite':
      return 'text-favorite fill-current';
    case 'success':
      return 'text-success';
    case 'destructive':
      return 'text-destructive';
    default:
      return undefined;
    }
  };

  const renderSurfaceButton = (cfg: ActionConfig) => {
    const depleted = isQuotaDepleted(cfg);
    const low = isQuotaLow(cfg);
    const tone = depleted ? undefined : cfg.isActive ? cfg.activeTone : undefined;
    const iconExtra =
      cfg.isActive && tone === 'favorite' && !depleted ? 'fill-current' : undefined;
    const tooltip = depleted
      ? t('actions.quotaExhausted', { label: cfg.label })
      : low
        ? t('actions.quotaLow', { label: cfg.label, count: cfg.quota!.balance })
        : cfg.label;
    return (
      <Tooltip key={cfg.key}>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            // Suppress the action while depleted, but keep onClick installed
            // so the tooltip + cursor changes still wire up cleanly.
            onClick={depleted ? (e) => e.preventDefault() : cfg.onClick}
            aria-disabled={depleted}
            aria-label={tooltip}
            className={`${triggerClassName} ${toneClassesForButton(tone)} ${
              depleted
                ? 'opacity-40 cursor-not-allowed hover:bg-transparent hover:text-muted-foreground'
                : ''
            } ${low ? 'relative' : ''}`}
          >
            <cfg.Icon
              className={`${triggerIconClassName}${iconExtra ? ` ${iconExtra}` : ''}`}
            />
            {low && !depleted ? (
              <span
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 inline-flex h-2 w-2 rounded-full bg-amber-500"
              />
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
    );
  };

  const renderMenuItem = (cfg: ActionConfig) => {
    const depleted = isQuotaDepleted(cfg);
    const low = isQuotaLow(cfg);
    const iconTone = depleted
      ? undefined
      : cfg.isActive
        ? toneClassForMenuIcon(cfg.activeTone)
        : undefined;
    const isPinned = pinnedSet.has(cfg.key);
    const canPinMore = pinnedKeys.length < MAX_PINNED_CARD_ACTIONS;
    const atMaxPins = !isPinned && !canPinMore;
    const pinDisabled = !onUpdatePinnedActions || atMaxPins;
    // Two distinct tooltip messages: a max-reached hint when the limit is
    // hit (more useful than restating "Pin X to card" on a disabled button),
    // otherwise the regular pin/unpin label.
    const pinTooltip = atMaxPins
      ? t('actions.pinMaxReached', { max: MAX_PINNED_CARD_ACTIONS })
      : isPinned
        ? t('actions.unpinFromCard', { label: cfg.label })
        : t('actions.pinToCard', { label: cfg.label });
    const pinAriaLabel = atMaxPins
      ? t('actions.pinMaxReached', { max: MAX_PINNED_CARD_ACTIONS })
      : isPinned
        ? t('actions.unpinFromCard', { label: cfg.label })
        : t('actions.pinToCard', { label: cfg.label });
    const rowTooltip = depleted
      ? t('actions.quotaExhausted', { label: cfg.label })
      : low
        ? t('actions.quotaLow', { label: cfg.label, count: cfg.quota!.balance })
        : cfg.label;

    const handlePinClick = (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (pinDisabled) return;
      togglePin(cfg.key);
    };

    return (
      <DropdownMenuItem
        key={cfg.key}
        // Radix wraps `onSelect` so calling preventDefault keeps the menu
        // open — we want it to close on every successful select, so don't
        // prevent default. Just no-op when depleted.
        onSelect={depleted ? () => undefined : cfg.onClick}
        aria-disabled={depleted}
        className={`pl-1 ${
          depleted
            ? 'opacity-50 cursor-not-allowed data-[highlighted]:bg-transparent data-[highlighted]:text-inherit'
            : ''
        }`}
      >
        {onUpdatePinnedActions ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={pinAriaLabel}
                aria-pressed={isPinned}
                aria-disabled={pinDisabled}
                // We use aria-disabled instead of the `disabled` attribute so
                // hovering still fires pointer events on the button — the
                // disabled-pointer-events default would prevent the tooltip
                // from showing, which is exactly when we want the "max 3"
                // hint to surface.
                // Block Radix from treating the pointer events as a menu-item
                // activation. Radix's DropdownMenuItem synthesizes a click on
                // the menu item from its own `pointerup` (so touch devices
                // still fire onSelect) — that synthesized click bubbles into
                // the row's onSelect even if we stop the React click. We
                // therefore have to stop the pointer events *before* they
                // reach the menu item: pointerdown, pointerup, and click.
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={handlePinClick}
                className={`mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground ${
                  isPinned ? 'text-foreground' : ''
                }`}
              >
                <Pin
                  className={`h-3.5 w-3.5${isPinned ? ' fill-current' : ''}`}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{pinTooltip}</TooltipContent>
          </Tooltip>
        ) : null}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex flex-1 items-center gap-2">
              <cfg.Icon className={iconTone} />
              <span>{cfg.label}</span>
              {depleted ? (
                <span className="ml-auto inline-flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  <Lock className="h-2.5 w-2.5" />
                  {t('actions.quotaBadgeZero')}
                </span>
              ) : low ? (
                <span className="ml-auto inline-flex items-center rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                  {t('actions.quotaBadgeLeft', { count: cfg.quota!.balance })}
                </span>
              ) : null}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right">{rowTooltip}</TooltipContent>
        </Tooltip>
      </DropdownMenuItem>
    );
  };

  // `triggerRef` is no longer used (the onboarding tutorial used to dispatch
  // window events to imperatively open this menu; it now just highlights
  // the trigger without opening it), but the ref is harmless to keep on
  // the trigger element in case a future caller wants the imperative path
  // back. The window-event listener has been removed.
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <div
      className="flex items-center"
      data-coachmark-anchor="card-actions"
      data-tutorial="card-actions"
    >
      {pinnedKeys.map((key) => renderSurfaceButton(actions[key]))}
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
          >
            <MoreHorizontal className={triggerIconClassName} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[14rem]">
          {actions.edit.available && renderMenuItem(actions.edit)}
          {renderMenuItem(actions.favorite)}
          {renderMenuItem(actions.master)}
          {renderMenuItem(actions.hide)}
          {actions.regenerateAudio.available &&
            renderMenuItem(actions.regenerateAudio)}
          {actions.flag.available && renderMenuItem(actions.flag)}
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
