'use client';

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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('actions.more')}
            className={`${triggerClassName} text-muted-foreground hover:text-foreground hover:bg-muted`}
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
