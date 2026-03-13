'use client';

import { useState, useEffect, useMemo } from 'react';
import { useMutation } from 'convex/react';
import { useTranslations, useLocale } from 'next-intl';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Info,
  Lock,
  Loader2,
  X,
} from 'lucide-react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import { DualLanguageEditor } from '@/components/course/DualLanguageEditor';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import PaywallDialog from '@/components/autumn/paywall-dialog';

interface CourseData {
  _id: Id<'courses'>;
  baseLanguages: string[];
  targetLanguages: string[];
}

interface CourseLanguageSettingsProps {
  course: CourseData | null;
  onClose: () => void;
}

export function CourseLanguageSettings({
  course,
  onClose,
}: CourseLanguageSettingsProps) {
  const t = useTranslations('AppPage.courses.manage');
  const locale = useLocale();
  const updateCourseLanguages = useMutation(
    api.features.courses.updateCourseLanguages,
  );

  const { isAvailable: hasMultipleLanguages } = useFeatureQuota(FEATURE_IDS.MULTIPLE_LANGUAGES);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const maxTotal = hasMultipleLanguages ? 5 : 2;
  const maxPerGroup = hasMultipleLanguages ? 3 : 1;

  const [draftBase, setDraftBase] = useState<string[]>([]);
  const [draftTarget, setDraftTarget] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState<string[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (course) {
      setDraftBase([...course.baseLanguages]);
      setDraftTarget([...course.targetLanguages]);
      setSavedCodes([
        ...course.baseLanguages,
        ...course.targetLanguages,
      ]);
      setHasChanges(false);
      setSaving(false);
      setError(null);
    }
  }, [course?._id]);

  const handleDraftChange = (base: string[], target: string[]) => {
    setDraftBase(base);
    setDraftTarget(target);
    setHasChanges(true);
    setError(null);
  };

  const newlyAdded = useMemo(() => {
    const all = [...draftBase, ...draftTarget];
    return all.filter((code) => !savedCodes.includes(code));
  }, [draftBase, draftTarget, savedCodes]);

  const missingBase = draftBase.length === 0;
  const missingTarget = draftTarget.length === 0;
  const canSave = hasChanges && !missingBase && !missingTarget;

  const handleSave = async () => {
    if (!course || !canSave) return;
    setSaving(true);
    setError(null);
    try {
      await updateCourseLanguages({
        courseId: course._id,
        baseLanguages: draftBase,
        targetLanguages: draftTarget,
      });
      setSavedCodes([...draftBase, ...draftTarget]);
      setHasChanges(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    onClose();
    setHasChanges(false);
    setError(null);
  };

  const formatName = (codes: string[]) =>
    codes
      .map((c) => getLocalizedLanguageNameByCode(c, locale))
      .join(', ');

  const editorLabels = {
    baseLanguages: t('baseLanguages'),
    targetLanguages: t('targetLanguages'),
    addLanguage: t('addLanguage'),
    noMoreAvailable: t('noMoreAvailable'),
    cancel: t('cancelButton'),
  };

  return (
    <Sheet open={!!course} onOpenChange={handleClose}>
      <SheetContent
        side="left"
        className="w-full sm:max-w-md p-0 [&>button:last-child]:hidden z-[60]"
      >
        <SheetDescription className="sr-only">{t('title')}</SheetDescription>

        {course && (
          <>
            <div className="sheet-header">
              <SheetTitle className="heading-section">
                {t('title')}
              </SheetTitle>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleClose}
                className="-mr-2"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="sheet-body space-y-4">
              {hasMultipleLanguages && (
                <div className="rounded-lg bg-muted/50 px-3 py-2.5 flex gap-2">
                  <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {t('infoText', { max: maxTotal })}
                  </p>
                </div>
              )}

              {!hasMultipleLanguages && (
                <button
                  onClick={() => setPaywallOpen(true)}
                  className="w-full rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 flex gap-2 text-left hover:bg-primary/10 transition-colors"
                >
                  <Lock className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-primary leading-relaxed">
                    {t('upgradeForMoreLanguages')}
                  </p>
                </button>
              )}

              <DualLanguageEditor
                baseLanguages={draftBase}
                targetLanguages={draftTarget}
                maxPerGroup={maxPerGroup}
                minPerGroup={1}
                maxTotal={maxTotal}
                lockedCodes={savedCodes}
                locale={locale}
                labels={editorLabels}
                onChange={handleDraftChange}
              />

              {(missingBase || missingTarget) && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex gap-2 animate-in fade-in duration-200">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive leading-relaxed">
                    {missingBase && missingTarget
                      ? t('warningBoth')
                      : missingBase
                        ? t('warningBase')
                        : t('warningTarget')}
                  </p>
                </div>
              )}

              {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex gap-2 animate-in fade-in duration-200">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive leading-relaxed">
                    {error}
                  </p>
                </div>
              )}

              {hasChanges && (
                <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
                  {newlyAdded.length > 0 && (
                    <div className="flex gap-2 px-1">
                      <AlertTriangle className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {t('confirmAdding', {
                          languages: formatName(newlyAdded),
                        })}
                      </p>
                    </div>
                  )}

                  <Button
                    size="sm"
                    disabled={!canSave || saving}
                    className="w-full gap-1.5"
                    onClick={handleSave}
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Check className="h-3.5 w-3.5" />
                    )}
                    {t('confirmButton')}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>

      {paywallOpen && (
        <PaywallDialog
          open={paywallOpen}
          setOpen={setPaywallOpen}
          featureId={FEATURE_IDS.MULTIPLE_LANGUAGES}
        />
      )}
    </Sheet>
  );
}
