'use client';

import { useState, useRef, useCallback, type ReactNode } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ConvexError } from 'convex/values';
import { getUserTimezone } from '@/lib/timezone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ChevronLeft, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import {
  MAX_CARD_TEXT_LENGTH,
  CARD_TEXT_SHOW_COUNT_REMAINING_THRESHOLD,
} from '@/lib/constants/learning';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { useFeatureQuota } from '@/components/feature_tracking/useFeatureQuota';
import { FeatureGatedButton } from '@/components/feature_tracking/FeatureGatedButton';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { useCourseLanguages } from '@/hooks/use-course-languages';

interface EnterTextsViewProps {
  onBack: () => void;
  hideHeader?: boolean;
  headerSlot?: ReactNode;
}

export function EnterTextsView({ onBack, hideHeader = false, headerSlot }: EnterTextsViewProps) {
  const t = useTranslations('EnterTexts');
  const locale = useLocale();
  const { baseLanguages, targetLanguages } = useCourseLanguages();
  const saveQuota = useFeatureQuota(FEATURE_IDS.CUSTOM_SENTENCES);
  const autoFillQuota = useFeatureQuota(FEATURE_IDS.TRANSLATION_AUTO_FILL);

  const createCustomText = useMutation(api.features.customTexts.createCustomText);
  const autoFillTranslations = useAction(api.features.customTexts.autoFillTranslations);

  type SentenceMetadata = {
    register: 'formal' | 'informal' | 'neutral';
    addresseeNumber: 'singular' | 'plural' | 'not_applicable';
    speakerGender: 'male' | 'female' | 'neutral';
    addresseeGender: 'male' | 'female' | 'neutral' | 'not_applicable';
  };

  const [texts, setTexts] = useState<Record<string, string>>({});
  const [userEditedLangs, setUserEditedLangs] = useState<Set<string>>(new Set());
  const [autoFillMetadata, setAutoFillMetadata] = useState<SentenceMetadata | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallFeatureId, setPaywallFeatureId] = useState<string>(
    FEATURE_IDS.CUSTOM_SENTENCES,
  );

  const firstInputRef = useRef<HTMLInputElement>(null);

  const orderedLanguages = [
    ...baseLanguages.filter((l) => !targetLanguages.includes(l)),
    ...targetLanguages,
  ];

  const hasLanguages = orderedLanguages.length > 0;

  const sourceLangs = orderedLanguages.filter(
    (lang) => userEditedLangs.has(lang) && (texts[lang] ?? '').trim().length > 0,
  );
  const emptyLanguages = orderedLanguages.filter((lang) => (texts[lang] ?? '').trim().length === 0);

  const hasOverLimit = Object.values(texts).some(
    (text) => text.length > MAX_CARD_TEXT_LENGTH,
  );
  const allFilled = orderedLanguages.length > 0 && emptyLanguages.length === 0;
  const canSave =
    hasLanguages && allFilled && !hasOverLimit && !isSaving && !isAutoFilling;
  const hasMultipleLanguages = orderedLanguages.length > 1;
  const canAutoFill =
    hasLanguages &&
    sourceLangs.length > 0 &&
    hasMultipleLanguages &&
    !allFilled &&
    !isAutoFilling &&
    !isSaving;

  const hasAnythingToReset =
    userEditedLangs.size > 0 ||
    orderedLanguages.some((lang) => (texts[lang] ?? '').trim().length > 0);
  const canReset = hasLanguages && hasAnythingToReset && !isSaving && !isAutoFilling;

  const handleReset = useCallback(() => {
    setTexts({});
    setUserEditedLangs(new Set());
    setAutoFillMetadata(null);
    firstInputRef.current?.focus();
  }, []);

  const handleAutoFill = useCallback(async () => {
    if (!autoFillQuota.isAvailable) {
      setPaywallFeatureId(FEATURE_IDS.TRANSLATION_AUTO_FILL);
      setPaywallOpen(true);
      return;
    }

    const sourceTexts = sourceLangs.map((lang) => ({
      language: lang,
      text: texts[lang].trim(),
    }));
    const langsToFill = orderedLanguages.filter(
      (lang) => !sourceLangs.includes(lang),
    );

    if (langsToFill.length === 0) return;

    const editedSnapshot = userEditedLangs;

    setIsAutoFilling(true);
    try {
      const { translations: results, metadata } = await autoFillTranslations({
        texts: sourceTexts,
        targetLanguages: langsToFill,
      });
      setTexts((prev) => {
        const next = { ...prev };
        for (const r of results) {
          const manualBlock =
            editedSnapshot.has(r.language) &&
            (prev[r.language] ?? '').trim().length > 0;
          if (manualBlock) continue;
          next[r.language] = r.text;
        }
        return next;
      });
      setAutoFillMetadata(metadata);
    } catch (err) {
      if (
        err instanceof ConvexError &&
        typeof err.data === 'object' &&
        err.data !== null &&
        'code' in err.data &&
        err.data.code === 'USAGE_LIMIT'
      ) {
        setPaywallFeatureId(FEATURE_IDS.TRANSLATION_AUTO_FILL);
        setPaywallOpen(true);
        return;
      }
      console.error('Auto-fill failed:', err);
      toast.error(t('autoFillError'));
    } finally {
      setIsAutoFilling(false);
    }
  }, [
    autoFillQuota.isAvailable,
    sourceLangs,
    orderedLanguages,
    texts,
    userEditedLangs,
    autoFillTranslations,
    t,
  ]);

  const handleSave = useCallback(async () => {
    if (!saveQuota.isAvailable) {
      setPaywallFeatureId(FEATURE_IDS.CUSTOM_SENTENCES);
      setPaywallOpen(true);
      return;
    }

    setIsSaving(true);
    try {
      const translations = orderedLanguages.map((lang) => ({
        language: lang,
        text: texts[lang].trim(),
      }));
      await createCustomText({
        translations,
        timezone: getUserTimezone(),
        ...(autoFillMetadata ? { metadata: autoFillMetadata } : {}),
      });
      toast.success(t('saveSuccess'));
      setTexts({});
      setUserEditedLangs(new Set());
      setAutoFillMetadata(null);
      firstInputRef.current?.focus();
    } catch (err) {
      if (
        err instanceof ConvexError &&
        typeof err.data === 'object' &&
        err.data !== null &&
        'code' in err.data
      ) {
        if (err.data.code === 'USAGE_LIMIT') {
          setPaywallFeatureId(FEATURE_IDS.CUSTOM_SENTENCES);
          setPaywallOpen(true);
          return;
        }
      }
      console.error('Save failed:', err);
      toast.error(t('saveError'));
    } finally {
      setIsSaving(false);
    }
  }, [saveQuota.isAvailable, orderedLanguages, texts, createCustomText, t, autoFillMetadata]);

  return (
    <>
      <div className="flex flex-col h-full">
        {!hideHeader && (
          <header className="sticky-header">
            <div className="container mx-auto px-4 h-14 flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 -ml-2"
                aria-label={t('back')}
                onClick={onBack}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h1 className="font-semibold text-base truncate flex-1">{t('title')}</h1>
            </div>
          </header>
        )}

        <div
          className="flex-1 overflow-y-auto px-4 py-4"
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className="app-view space-y-4">
            {headerSlot}
            <p className="text-muted-sm">
              {hasLanguages ? t('description') : t('noLanguages')}
            </p>

            {hasLanguages &&
              orderedLanguages.map((lang, idx) => {
                const value = texts[lang] ?? '';
                const isOverLimit = value.length > MAX_CARD_TEXT_LENGTH;
                const remaining = MAX_CARD_TEXT_LENGTH - value.length;
                const showCharCount =
                  isOverLimit ||
                  remaining <= CARD_TEXT_SHOW_COUNT_REMAINING_THRESHOLD;
                return (
                  <div key={lang} className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <Label htmlFor={`enter-${lang}`}>
                        {getLocalizedLanguageNameByCode(lang, locale)}
                      </Label>
                      {showCharCount && (
                        <span
                          className={`text-xs tabular-nums shrink-0 ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
                        >
                          {isOverLimit
                            ? `+${value.length - MAX_CARD_TEXT_LENGTH}`
                            : `${value.length}/${MAX_CARD_TEXT_LENGTH}`}
                        </span>
                      )}
                    </div>
                    <Input
                      ref={idx === 0 ? firstInputRef : undefined}
                      id={`enter-${lang}`}
                      value={value}
                      placeholder={t('inputPlaceholder', {
                        language: getLocalizedLanguageNameByCode(lang, locale),
                      })}
                      onChange={(e) => {
                        const val = e.target.value;
                        setTexts((prev) => ({ ...prev, [lang]: val }));
                        setUserEditedLangs((prev) => {
                          if (prev.has(lang)) return prev;
                          const next = new Set(prev);
                          next.add(lang);
                          return next;
                        });
                        // Any edit invalidates auto-fill metadata; the server will regenerate it.
                        setAutoFillMetadata(null);
                      }}
                      className={
                        isOverLimit
                          ? 'border-destructive focus-visible:ring-destructive'
                          : ''
                      }
                      disabled={isAutoFilling}
                    />
                  </div>
                );
              })}

            <div className="flex flex-col gap-2 pt-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={handleAutoFill}
                  disabled={!canAutoFill}
                >
                  {isAutoFilling ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin mr-2" />
                  ) : (
                    <Sparkles className="h-4 w-4 shrink-0 mr-2" />
                  )}
                  {isAutoFilling ? t('autoFilling') : t('autoFill')}
                </Button>
                <FeatureGatedButton
                  featureId={FEATURE_IDS.CUSTOM_SENTENCES}
                  className="flex-1 gap-2"
                  onAction={handleSave}
                  disabled={
                    saveQuota.isLoading ||
                    (saveQuota.isAvailable && !canSave)
                  }
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin mr-2" />
                      {t('saving')}
                    </>
                  ) : (
                    t('save')
                  )}
                </FeatureGatedButton>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={handleReset}
                disabled={!canReset}
              >
                {t('reset')}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {paywallOpen && (
        <PaywallDialog
          open={paywallOpen}
          setOpen={setPaywallOpen}
          featureId={paywallFeatureId}
        />
      )}
    </>
  );
}
