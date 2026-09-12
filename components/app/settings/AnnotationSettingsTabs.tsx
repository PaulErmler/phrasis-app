'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ANNOTATION_KIND_NAMES,
  annotationAppliesTo,
  resolveAnnotationDisplay,
  type AnnotationKindName,
  type AnnotationSettings,
  type GlossScope,
} from '@/lib/annotationDisplay';

/**
 * The reading-aid section of the learning-mode settings sheet: romanization,
 * the word-for-word gloss, furigana and IPA, each switchable for the whole
 * course OR for one language.
 *
 * Two views over one piece of state. The "All" tab is the sheet as it always
 * was — one switch per aid — except that the language chips under each row are
 * now buttons: tapping one makes an exception for that language without
 * leaving the tab, and the row's switch sets the course value and clears that
 * aid's exceptions. A language tab shows only the aids that language has, each
 * marked as following the course or having its own setting.
 *
 * Renders NOTHING — not even its own heading — when no course language has any
 * aid, which is why the separator and the section title live in here rather
 * than in the sheet: a lone heading over an empty section is the bug that
 * shape invites.
 *
 * The exceptions live in `courseSettings.annotationOverrides`, and
 * `resolveAnnotationDisplay` is the single definition of how they combine with
 * the course-wide switches — the same function the content sweep asks, so a
 * card cannot show something different from what was generated.
 */

export type AnnotationOverrides = NonNullable<
  AnnotationSettings['annotationOverrides']
>;

export interface AnnotationSettingsTabsProps {
  settings: AnnotationSettings;
  /** Every language on the course, deduplicated, in the course's own order. */
  courseLanguages: string[];
  /** Which languages get a gloss, and the language it is written in. */
  gloss: GlossScope;
  /** Localized display name for a language code. */
  languageName: (code: string) => string;
  /** Write the course-wide switch for one aid, plus the new overrides. */
  onSetCourseWide: (
    kind: AnnotationKindName,
    value: boolean,
    overrides: AnnotationOverrides,
  ) => void;
  /** Write only the overrides. */
  onSetOverrides: (overrides: AnnotationOverrides) => void;
}

/** Settings-sheet field name for an aid's course-wide switch. Doubles as the
 *  i18n key stem: `showIpa` / `showIpaDescription`. Exported because the sheet
 *  that owns the mutation writes through the same map. */
export const ANNOTATION_FIELD = {
  romanization: 'showRomanization',
  ipa: 'showIpa',
  furigana: 'showFurigana',
  hyperliteral: 'showHyperliteral',
} as const satisfies Record<AnnotationKindName, string>;

export function AnnotationSettingsTabs({
  settings,
  courseLanguages,
  gloss,
  languageName,
  onSetCourseWide,
  onSetOverrides,
}: AnnotationSettingsTabsProps) {
  const t = useTranslations('LearningMode.settingsPanel');
  const [tab, setTab] = useState('all');

  // An aid appears at all only where some course language has it, which is
  // what has always gated this section.
  const languagesFor = (kind: AnnotationKindName) =>
    courseLanguages.filter((language) =>
      annotationAppliesTo(kind, language, gloss),
    );
  const kinds = ANNOTATION_KIND_NAMES.filter(
    (kind) => languagesFor(kind).length > 0,
  );
  const overrides: AnnotationOverrides = settings.annotationOverrides ?? {};
  const resolved = (language: string) =>
    resolveAnnotationDisplay(settings, language, gloss);
  /** The course-wide value of an aid, ignoring every exception. */
  const courseValueOf = (kind: AnnotationKindName, language: string) =>
    resolveAnnotationDisplay(
      { ...settings, annotationOverrides: {} },
      language,
      gloss,
    )[kind];

  const bodyRef = useRef<HTMLDivElement>(null);
  const [heldHeight, setHeldHeight] = useState(0);
  useLayoutEffect(() => {
    const measured = bodyRef.current?.offsetHeight ?? 0;
    setHeldHeight((tallest) => (measured > tallest ? measured : tallest));
  }, [tab, kinds.length, settings]);

  if (kinds.length === 0) return null;

  // Only languages with at least one aid get a tab; an empty tab is a dead end.
  const tabLanguages = courseLanguages.filter((language) =>
    kinds.some((kind) => annotationAppliesTo(kind, language, gloss)),
  );

  /** Overrides with one (language, kind) set, pruned when it matches the
   *  course value again so returning to the default leaves no trace. */
  const withOverride = (
    language: string,
    kind: AnnotationKindName,
    value: boolean,
  ): AnnotationOverrides => {
    const next: AnnotationOverrides = { ...overrides };
    const entry = { ...(next[language] ?? {}) };
    if (value === courseValueOf(kind, language)) delete entry[kind];
    else entry[kind] = value;
    if (Object.keys(entry).length === 0) delete next[language];
    else next[language] = entry;
    return next;
  };

  /** Overrides with every exception for one aid removed. */
  const withoutKind = (kind: AnnotationKindName): AnnotationOverrides => {
    const next: AnnotationOverrides = {};
    for (const [language, entry] of Object.entries(overrides)) {
      const rest = { ...entry };
      delete rest[kind];
      if (Object.keys(rest).length > 0) next[language] = rest;
    }
    return next;
  };

  const exceptionsFor = (kind: AnnotationKindName) =>
    languagesFor(kind).filter(
      (language) => overrides[language]?.[kind] !== undefined,
    );

  /** One aid's row, for whichever tab is asking. */
  const allTabRow = (kind: AnnotationKindName) => {
    const exceptions = exceptionsFor(kind);
    const courseValue = courseValueOf(kind, languagesFor(kind)[0]);
    return (
      <div className="settings-row" key={kind}>
        <div className="space-y-0.5">
          <Label
            htmlFor={ANNOTATION_FIELD[kind]}
            className="text-sm font-medium"
          >
            {t(ANNOTATION_FIELD[kind])}
            {exceptions.length > 0 && (
              <span className="ml-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                {t('annotationExceptions', { count: exceptions.length })}
              </span>
            )}
          </Label>
          <p className="text-muted-xs">
            {t(`${ANNOTATION_FIELD[kind]}Description`)}
          </p>
          <div className="flex flex-wrap gap-1 pt-1">
            {languagesFor(kind).map((language) => {
              const on = resolved(language)[kind];
              return (
                <button
                  key={language}
                  type="button"
                  aria-pressed={on}
                  data-testid={`chip-${kind}-${language}`}
                  className={
                    on
                      ? 'rounded-full border border-primary bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground'
                      : 'rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground'
                  }
                  onClick={() =>
                    onSetOverrides(withOverride(language, kind, !on))
                  }
                >
                  {languageName(language)}
                </button>
              );
            })}
          </div>
        </div>
        <Switch
          id={ANNOTATION_FIELD[kind]}
          // Explicit, because the label also carries the exceptions badge:
          // without this the switch announces as
          // "Show romanization 2 exceptions".
          aria-label={t(ANNOTATION_FIELD[kind])}
          checked={courseValue}
          onCheckedChange={(value) =>
            // Setting the course value clears this aid's exceptions: the
            // switch reads as "all of them", so leaving a language behind
            // would contradict the gesture.
            onSetCourseWide(kind, value, withoutKind(kind))
          }
        />
      </div>
    );
  };

  const languageTabRow = (kind: AnnotationKindName, language: string) => {
    const own = overrides[language]?.[kind] !== undefined;
    const on = resolved(language)[kind];
    return (
      <div className="settings-row" key={kind}>
        <div className="space-y-0.5">
          <Label
            htmlFor={`${ANNOTATION_FIELD[kind]}-${language}`}
            className="text-sm font-medium"
          >
            {t(ANNOTATION_FIELD[kind])}
            <span
              className={
                own
                  ? 'ml-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary'
                  : 'ml-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground'
              }
            >
              {own ? t('annotationOwnSetting') : t('annotationFollowsCourse')}
            </span>
          </Label>
          <p className="text-muted-xs">
            {t(`${ANNOTATION_FIELD[kind]}Description`)}
          </p>
          {own && (
            <button
              type="button"
              className="mt-1 text-left text-[11px] text-muted-foreground underline-offset-2 hover:underline"
              onClick={() => {
                const next: AnnotationOverrides = { ...overrides };
                const entry = { ...(next[language] ?? {}) };
                delete entry[kind];
                if (Object.keys(entry).length === 0) delete next[language];
                else next[language] = entry;
                onSetOverrides(next);
              }}
            >
              {t('annotationFollowCourseAgain')}
            </button>
          )}
        </div>
        <Switch
          id={`${ANNOTATION_FIELD[kind]}-${language}`}
          // Explicit, for the same reason as the All tab: the label carries
          // the follows-course / own-setting badge.
          aria-label={`${t(ANNOTATION_FIELD[kind])}-${language}`}
          checked={on}
          onCheckedChange={(value) =>
            onSetOverrides(withOverride(language, kind, value))
          }
        />
      </div>
    );
  };

  // Only the ACTIVE panel is rendered. An earlier version stacked every panel
  // in one CSS grid cell so the container kept the tallest height, but leaving
  // the inactive ones mounted meant their Switches were still animating their
  // own state behind the swap: the buttons visibly settled after the text had
  // already changed.
  //
  // So the height is held instead of the markup. The container remembers the
  // tallest it has ever been and never shrinks below it, which is what stops
  // the content underneath jumping when a language tab lists fewer aids than
  // the All tab.

  const activePanel =
    tab === 'all' ? (
      <>{kinds.map(allTabRow)}</>
    ) : (
      kinds
        .filter((kind) => annotationAppliesTo(kind, tab, gloss))
        .map((kind) => languageTabRow(kind, tab))
    );

  return (
    <div className="space-y-2">
      <Separator />
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        {t('languageSettings')}
      </p>
      {/* Wraps rather than sharing one fixed-height row. The shared TabsList is
          a 36px bar whose triggers never wrap, so a course with several
          long-named languages ("Spanish (Spain)", "English (Mixed)") pushed
          the last one off the edge and clipped it. Language count and name
          length are both outside this component's control, so the row has to
          grow instead of the labels having to fit. */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="all" className="h-8 flex-none">
            {t('annotationsAllTab')}
          </TabsTrigger>
          {tabLanguages.map((language) => (
            <TabsTrigger
              key={language}
              value={language}
              className="h-8 flex-none"
            >
              {languageName(language)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div
        ref={bodyRef}
        className="space-y-2"
        style={{ minHeight: heldHeight || undefined }}
      >
        {activePanel}
      </div>
    </div>
  );
}
