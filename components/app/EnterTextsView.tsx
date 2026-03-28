'use client';

import { useState, useRef, useCallback } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { ConvexError } from 'convex/values';
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
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { useCourseLanguages } from '@/hooks/use-course-languages';

interface EnterTextsViewProps {
  onBack: () => void;
}

export function EnterTextsView({ onBack }: EnterTextsViewProps) {
  const t = useTranslations('EnterTexts');
  const locale = useLocale();
  const { baseLanguages, targetLanguages } = useCourseLanguages();
  const saveQuota = useFeatureQuota(FEATURE_IDS.CUSTOM_SENTENCES);
  const autoFillQuota = useFeatureQuota(FEATURE_IDS.TRANSLATION_AUTO_FILL);

  const createCustomText = useMutation(api.features.customTexts.createCustomText);
  const autoFillTranslations = useAction(api.features.customTexts.autoFillTranslations);

  const [texts, setTexts] = useState<Record<string, string>>({});
  const [userEditedLangs, setUserEditedLangs] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [paywallFeatureId, setPaywallFeatureId] = useState(FEATURE_IDS.CUSTOM_SENTENCES);

  const firstInputRef = useRef<HTMLInputElement>(null);

  const orderedLanguages = [
    ...baseLanguages.filter((l) => !targetLanguages.includes(l)),
    ...targetLanguages,
  ];

  const sourceLangs = orderedLanguages.filter(
    (lang) => userEditedLangs.has(lang) && (texts[lang] ?? '').trim().length > 0,
  );
  const emptyLanguages = orderedLanguages.filter((lang) => (texts[lang] ?? '').trim().length === 0);

  const hasOverLimit = Object.values(texts).some(
    (text) => text.length > MAX_CARD_TEXT_LENGTH,
  );
  const allFilled = orderedLanguages.length > 0 && emptyLanguages.length === 0;
  const canSave = allFilled && !hasOverLimit && !isSaving && !isAutoFilling;
  const hasMultipleLanguages = orderedLanguages.length > 1;
  const canAutoFill = sourceLangs.length > 0 && hasMultipleLanguages && !isAutoFilling && !isSaving;

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

    setIsAutoFilling(true);
    try {
      const results = await autoFillTranslations({
        texts: sourceTexts,
        targetLanguages: langsToFill,
      });
      setTexts((prev) => {
        const next = { ...prev };
        for (const r of results) {
          next[r.language] = r.text;
        }
        return next;
      });
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
  }, [autoFillQuota.isAvailable, sourceLangs, orderedLanguages, texts, autoFillTranslations, t]);

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
      await createCustomText({ translations });
      toast.success(t('saveSuccess'));
      setTexts({});
      setUserEditedLangs(new Set());
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
  }, [saveQuota.isAvailable, orderedLanguages, texts, createCustomText, t]);

  if (orderedLanguages.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex flex-col h-full">
        <header className="sticky-header">
          <div className="container mx-auto px-4 h-14 flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 -ml-2"
              onClick={onBack}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <h1 className="font-semibold text-base truncate flex-1">{t('title')}</h1>
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto px-4 py-4"
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className="app-view space-y-4">
            <p className="text-muted-sm">{t('description')}</p>

            {orderedLanguages.map((lang, idx) => {
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

            <div className="flex gap-2 pt-2">
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
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={!canSave}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin mr-2" />
                    {t('saving')}
                  </>
                ) : (
                  t('save')
                )}
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
