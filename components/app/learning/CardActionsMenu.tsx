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

export interface CardActionsMenuProps {
  isFavorite: boolean;
  isMastered?: boolean;
  isHidden?: boolean;
  onFavorite: () => void;
  onMaster: () => void;
  onHide: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Tailwind size classes for the trigger button (defaults to h-8 w-8). */
  triggerClassName?: string;
  /** Tailwind size for the icon inside the trigger (defaults to h-4 w-4). */
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
          <Star className={isFavorite ? 'text-favorite' : undefined} />
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
  );
}
