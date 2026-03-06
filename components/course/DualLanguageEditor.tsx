'use client';

import { useState, useCallback } from 'react';
import { Plus, GripVertical, X } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import {
  SUPPORTED_LANGUAGES,
  getLanguageByCode,
  getLocalizedLanguageNameByCode,
} from '@/lib/languages';
import { cn } from '@/lib/utils';

type ContainerId = 'base' | 'target';

export interface DualLanguageEditorLabels {
  baseLanguages: string;
  targetLanguages: string;
  addLanguage: string;
  noMoreAvailable: string;
  cancel: string;
}

interface DualLanguageEditorProps {
  baseLanguages: string[];
  targetLanguages: string[];
  maxPerGroup?: number;
  minPerGroup?: number;
  maxTotal?: number;
  lockedCodes?: string[];
  onChange: (base: string[], target: string[]) => void;
  showConnector?: boolean;
  locale?: string;
  labels?: DualLanguageEditorLabels;
}

function getDisplayName(code: string, locale?: string): string {
  if (locale) return getLocalizedLanguageNameByCode(code, locale);
  return getLanguageByCode(code)?.name ?? code;
}

function SortableItem({
  code,
  containerId,
  canRemove,
  locked,
  locale,
  onRemove,
}: {
  code: string;
  containerId: ContainerId;
  canRemove: boolean;
  locked: boolean;
  locale?: string;
  onRemove: () => void;
}) {
  const lang = getLanguageByCode(code);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: code, data: { containerId }, disabled: locked });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        'flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 transition-colors bg-background',
        containerId === 'base'
          ? 'border-timeline-base-border bg-timeline-base'
          : 'border-timeline-target-border bg-timeline-target',
        locked && 'opacity-70',
      )}
    >
      {!locked && (
        <button
          {...listeners}
          className="touch-none text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing -ml-1"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <span className="text-lg">{lang?.flag}</span>
      <span className="text-sm font-medium flex-1">
        {getDisplayName(code, locale)}
      </span>
      {canRemove && (
        <button
          onClick={onRemove}
          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function DragOverlayChip({
  code,
  containerId,
  locale,
}: {
  code: string;
  containerId: ContainerId;
  locale?: string;
}) {
  const lang = getLanguageByCode(code);
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 shadow-lg ring-2 ring-primary/30 bg-background',
        containerId === 'base'
          ? 'border-timeline-base-border bg-timeline-base'
          : 'border-timeline-target-border bg-timeline-target',
      )}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground" />
      <span className="text-lg">{lang?.flag}</span>
      <span className="text-sm font-medium flex-1">
        {getDisplayName(code, locale)}
      </span>
    </div>
  );
}

function DroppableGroup({
  id,
  label,
  items,
  allItems,
  maxPerGroup,
  minPerGroup,
  maxTotal,
  lockedCodes,
  locale,
  addLabel,
  noMoreLabel,
  cancelLabel,
  onAdd,
  onRemove,
}: {
  id: ContainerId;
  label: string;
  items: string[];
  allItems: string[];
  maxPerGroup: number;
  minPerGroup: number;
  maxTotal?: number;
  lockedCodes?: string[];
  locale?: string;
  addLabel: string;
  noMoreLabel: string;
  cancelLabel: string;
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
}) {
  const [showSelector, setShowSelector] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id });

  const atGroupMax = items.length >= maxPerGroup;
  const atTotalMax = maxTotal != null && allItems.length >= maxTotal;
  const canAdd = !atGroupMax && !atTotalMax;
  const availableLanguages = SUPPORTED_LANGUAGES.filter(
    (lang) => !allItems.includes(lang.code),
  );

  const isAtMin = items.length <= minPerGroup;
  const locked = lockedCodes ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {label}
        </p>
        {maxTotal == null && (
          <span className="text-muted-xs">
            {items.length}/{maxPerGroup}
          </span>
        )}
      </div>

      <SortableContext items={items} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            'space-y-1.5 min-h-[52px] rounded-lg p-1.5 -m-1.5 transition-colors',
            isOver && 'bg-primary/5 ring-1 ring-primary/20',
          )}
        >
          {items.map((code) => (
            <SortableItem
              key={code}
              code={code}
              containerId={id}
              canRemove={!locked.includes(code)}
              locked={isAtMin}
              locale={locale}
              onRemove={() => onRemove(code)}
            />
          ))}
        </div>
      </SortableContext>

      {canAdd && !showSelector && (
        <div className="pt-1">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5 h-8"
            onClick={() => setShowSelector(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            {addLabel}
          </Button>
        </div>
      )}

      {showSelector && (
        <div className="pt-1 rounded-xl border bg-card p-2 space-y-1 animate-in fade-in slide-in-from-top-2 duration-200">
          {availableLanguages.length === 0 ? (
            <p className="text-muted-xs text-center py-2">{noMoreLabel}</p>
          ) : (
            availableLanguages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  onAdd(lang.code);
                  setShowSelector(false);
                }}
                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted/50 transition-colors"
              >
                <span className="text-lg">{lang.flag}</span>
                <span className="text-sm font-medium">
                  {getDisplayName(lang.code, locale)}
                </span>
              </button>
            ))
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full h-7 text-muted-foreground"
            onClick={() => setShowSelector(false)}
          >
            {cancelLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

const DEFAULT_LABELS: DualLanguageEditorLabels = {
  baseLanguages: 'Base Languages',
  targetLanguages: 'Target Languages',
  addLanguage: 'Add Language',
  noMoreAvailable: 'No more languages available',
  cancel: 'Cancel',
};

export function DualLanguageEditor({
  baseLanguages,
  targetLanguages,
  maxPerGroup = 3,
  minPerGroup = 0,
  maxTotal,
  lockedCodes,
  onChange,
  showConnector = false,
  locale,
  labels,
}: DualLanguageEditorProps) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const [activeId, setActiveId] = useState<string | null>(null);

  const findContainer = useCallback(
    (id: string): ContainerId | null => {
      if (id === 'base' || id === 'target') return id as ContainerId;
      if (baseLanguages.includes(id)) return 'base';
      if (targetLanguages.includes(id)) return 'target';
      return null;
    },
    [baseLanguages, targetLanguages],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(active.id as string);
    const overContainer = findContainer(over.id as string);

    if (
      !activeContainer ||
      !overContainer ||
      activeContainer === overContainer
    )
      return;

    const sourceList =
      activeContainer === 'base'
        ? [...baseLanguages]
        : [...targetLanguages];
    const destList =
      overContainer === 'base'
        ? [...baseLanguages]
        : [...targetLanguages];

    if (destList.length >= maxPerGroup) return;
    if (sourceList.length <= minPerGroup) return;

    const activeCode = active.id as string;
    const activeIndex = sourceList.indexOf(activeCode);
    if (activeIndex === -1) return;
    sourceList.splice(activeIndex, 1);

    const overIndex = destList.indexOf(over.id as string);
    if (overIndex !== -1) {
      destList.splice(overIndex, 0, activeCode);
    } else {
      destList.push(activeCode);
    }

    if (activeContainer === 'base') {
      onChange(sourceList, destList);
    } else {
      onChange(destList, sourceList);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;

    const activeContainer = findContainer(active.id as string);
    const overContainer = findContainer(over.id as string);

    if (!activeContainer || !overContainer) return;

    if (activeContainer === overContainer) {
      const list =
        activeContainer === 'base'
          ? [...baseLanguages]
          : [...targetLanguages];
      const oldIndex = list.indexOf(active.id as string);
      const newIndex = list.indexOf(over.id as string);

      if (oldIndex === -1 || newIndex === -1) return;

      list.splice(oldIndex, 1);
      list.splice(newIndex, 0, active.id as string);

      if (activeContainer === 'base') {
        onChange(list, targetLanguages);
      } else {
        onChange(baseLanguages, list);
      }
    }
  };

  const allItems = [...baseLanguages, ...targetLanguages];
  const activeContainer = activeId ? findContainer(activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-2">
        <DroppableGroup
          id="base"
          label={l.baseLanguages}
          items={baseLanguages}
          allItems={allItems}
          maxPerGroup={maxPerGroup}
          minPerGroup={minPerGroup}
          maxTotal={maxTotal}
          lockedCodes={lockedCodes}
          locale={locale}
          addLabel={l.addLanguage}
          noMoreLabel={l.noMoreAvailable}
          cancelLabel={l.cancel}
          onAdd={(code) =>
            onChange([...baseLanguages, code], targetLanguages)
          }
          onRemove={(code) =>
            onChange(
              baseLanguages.filter((c) => c !== code),
              targetLanguages,
            )
          }
        />

        {showConnector && (
          <div className="flex items-center justify-center py-1">
            <div className="w-px h-3 bg-border" />
          </div>
        )}

        <DroppableGroup
          id="target"
          label={l.targetLanguages}
          items={targetLanguages}
          allItems={allItems}
          maxPerGroup={maxPerGroup}
          minPerGroup={minPerGroup}
          maxTotal={maxTotal}
          lockedCodes={lockedCodes}
          locale={locale}
          addLabel={l.addLanguage}
          noMoreLabel={l.noMoreAvailable}
          cancelLabel={l.cancel}
          onAdd={(code) =>
            onChange(baseLanguages, [...targetLanguages, code])
          }
          onRemove={(code) =>
            onChange(
              baseLanguages,
              targetLanguages.filter((c) => c !== code),
            )
          }
        />
      </div>

      <DragOverlay>
        {activeId && activeContainer && (
          <DragOverlayChip
            code={activeId}
            containerId={activeContainer}
            locale={locale}
          />
        )}
      </DragOverlay>
    </DndContext>
  );
}
