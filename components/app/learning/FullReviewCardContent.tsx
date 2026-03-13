'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check } from 'lucide-react';
import { AudioButton } from './AudioButton';
import { CardShell } from './CardShell';
import { DiffDisplay } from './DiffDisplay';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import type { CardTranslation, CardAudioRecording } from './types';

type TargetAudioMode = 'always' | 'afterSubmit' | 'never';

interface LanguageInputState {
  submitted: boolean;
  userText: string;
}

interface FullReviewCardContentProps {
  preReviewCount: number;
  sourceText: string;
  translations: CardTranslation[];
  audioRecordings: CardAudioRecording[];
  isFavorite: boolean;
  isPendingMaster: boolean;
  isPendingHide: boolean;
  onMaster: () => void;
  onHide: () => void;
  onFavorite: () => void;
  onAudioPlay?: () => void;
  targetAudioMode: TargetAudioMode;
  bare?: boolean;
}

export function FullReviewCardContent({
  preReviewCount,
  sourceText,
  translations,
  audioRecordings,
  isFavorite,
  isPendingMaster,
  isPendingHide,
  onMaster,
  onHide,
  onFavorite,
  onAudioPlay,
  targetAudioMode,
  bare = false,
}: FullReviewCardContentProps) {
  const t = useTranslations('LearningMode');
  const locale = useLocale();

  const targetTranslations = translations.filter((tr) => tr.isTargetLanguage);
  const showLanguageLabel = targetTranslations.length > 1;

  const [inputs, setInputs] = useState<Map<string, LanguageInputState>>(
    () => new Map(targetTranslations.map((tr) => [tr.language, { submitted: false, userText: '' }])),
  );

  const autoPlayedRef = useRef<Set<string>>(new Set());
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  const translationKey = translations.map((tr) => tr.language + tr.text).join('|');
  const [prevTranslationKey, setPrevTranslationKey] = useState(translationKey);
  if (translationKey !== prevTranslationKey) {
    setPrevTranslationKey(translationKey);
    setInputs(
      new Map(targetTranslations.map((tr) => [tr.language, { submitted: false, userText: '' }])),
    );
    autoPlayedRef.current = new Set();
  }

  useEffect(() => {
    firstInputRef.current?.focus();
  }, [translationKey]);

  const handleInputChange = useCallback((language: string, text: string) => {
    setInputs((prev) => {
      const next = new Map(prev);
      next.set(language, { submitted: false, userText: text });
      return next;
    });
  }, []);

  const handleSubmit = useCallback((language: string) => {
    setInputs((prev) => {
      const current = prev.get(language);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(language, { ...current, submitted: true });
      return next;
    });
  }, []);

  return (
    <CardShell
      reviewCount={preReviewCount}
      sourceText={sourceText}
      translations={translations}
      audioRecordings={audioRecordings}
      isFavorite={isFavorite}
      isPendingMaster={isPendingMaster}
      isPendingHide={isPendingHide}
      onMaster={onMaster}
      onHide={onHide}
      onFavorite={onFavorite}
      onAudioPlay={onAudioPlay}
      bare={bare}
    >
      {({ targetTranslations: targets }) => (
        <div className="space-y-4">
          {targets.map((translation, index) => {
            const audio = audioRecordings.find(
              (a) => a.language === translation.language,
            );
            const state = inputs.get(translation.language) ?? {
              submitted: false,
              userText: '',
            };

            return (
              <TargetLanguageInput
                key={translation.language}
                translation={translation}
                audioUrl={audio?.url ?? null}
                state={state}
                targetAudioMode={targetAudioMode}
                autoPlayedRef={autoPlayedRef}
                onInputChange={handleInputChange}
                onSubmit={handleSubmit}
                onAudioPlay={onAudioPlay}
                submitLabel={t('submitAnswer')}
                placeholder={t('typeTranslation')}
                showLanguageLabel={showLanguageLabel}
                locale={locale}
                inputRef={index === 0 ? firstInputRef : undefined}
                autoFocus={index === 0}
              />
            );
          })}
        </div>
      )}
    </CardShell>
  );
}

interface TargetLanguageInputProps {
  translation: CardTranslation;
  audioUrl: string | null;
  state: LanguageInputState;
  targetAudioMode: TargetAudioMode;
  autoPlayedRef: React.RefObject<Set<string>>;
  onInputChange: (language: string, text: string) => void;
  onSubmit: (language: string) => void;
  onAudioPlay?: () => void;
  submitLabel: string;
  placeholder: string;
  showLanguageLabel: boolean;
  locale: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
}

function TargetLanguageInput({
  translation,
  audioUrl,
  state,
  targetAudioMode,
  autoPlayedRef,
  onInputChange,
  onSubmit,
  onAudioPlay,
  submitLabel,
  placeholder,
  showLanguageLabel,
  locale,
  inputRef,
  autoFocus,
}: TargetLanguageInputProps) {
  const autoPlayAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (
      !state.submitted ||
      targetAudioMode !== 'afterSubmit' ||
      !audioUrl ||
      autoPlayedRef.current.has(translation.language)
    ) {
      return;
    }

    autoPlayedRef.current.add(translation.language);
    onAudioPlay?.();
    const audio = new Audio(audioUrl);
    autoPlayAudioRef.current = audio;
    audio.play().catch((err) => {
      if (err.name !== 'AbortError') console.error('Auto-play failed:', err);
    });

    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, [state.submitted, targetAudioMode, audioUrl, translation.language, autoPlayedRef]);

  useEffect(() => {
    return () => {
      autoPlayAudioRef.current?.pause();
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !state.submitted) {
      e.preventDefault();
      onSubmit(translation.language);
    }
  };

  const languageDisplayName = showLanguageLabel
    ? getLocalizedLanguageNameByCode(translation.language, locale)
    : null;

  if (state.submitted) {
    return (
      <div className="space-y-1">
        {languageDisplayName ? (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {languageDisplayName}
            </span>
            <AudioButton
              url={audioUrl}
              language={translation.language.toUpperCase()}
              onPlay={onAudioPlay}
            />
          </div>
        ) : (
          <div className="flex justify-end">
            <AudioButton
              url={audioUrl}
              language={translation.language.toUpperCase()}
              onPlay={onAudioPlay}
            />
          </div>
        )}
        <DiffDisplay
          expected={translation.text}
          actual={state.userText}
          hideAccuracy={!state.userText.trim()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {languageDisplayName ? (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase">
            {languageDisplayName}
          </span>
          <AudioButton
            url={audioUrl}
            language={translation.language.toUpperCase()}
            onPlay={onAudioPlay}
          />
        </div>
      ) : (
        <div className="flex justify-end">
          <AudioButton
            url={audioUrl}
            language={translation.language.toUpperCase()}
            onPlay={onAudioPlay}
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          autoFocus={autoFocus}
          value={state.userText}
          onChange={(e) => onInputChange(translation.language, e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => onSubmit(translation.language)}
          className="h-9 w-9 shrink-0"
          aria-label={submitLabel}
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
