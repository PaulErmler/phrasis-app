'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Check, FileText, Undo2 } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { AudioButton } from './AudioButton';
import { CardSpeedBadge } from './CardSpeedBadge';
import { DiffDisplay } from './DiffDisplay';
import { HighlightedText } from './HighlightedText';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import type { ButtonPlaybackActive } from '@/hooks/use-button-playback';
import type { ClockBinding } from '@/hooks/use-karaoke-index';
import type { CardTranslation, WordTiming } from './types';

export type TargetAudioMode = 'always' | 'afterSubmit' | 'never';

export interface LanguageInputState {
  submitted: boolean;
  userText: string;
}

export interface TargetLanguageInputProps {
  translation: CardTranslation;
  audioUrl: string | null;
  wordTimings: WordTiming[] | null;
  state: LanguageInputState;
  targetAudioMode: TargetAudioMode;
  autoPlayedRef: React.RefObject<Set<string>>;
  /** Called with the language and the typed text at submit time. */
  onSubmit: (language: string, text: string) => void;
  onRevert: (language: string) => void;
  onAudioPlay?: () => void;
  submitLabel: string;
  placeholder: string;
  revertLabel: string;
  revertTooltip: string;
  showLanguageLabel: boolean;
  locale: string;
  /** Stable ref map — this row registers its input under its language. */
  inputRefsByLanguage: React.RefObject<Record<string, HTMLInputElement | null>>;
  /** Stable ref for the first target's input (card-change autofocus). */
  firstInputRef: React.RefObject<HTMLInputElement | null>;
  autoFocus?: boolean;
  isFirstTarget?: boolean;
  allRevealed?: boolean;
  showRomanization?: boolean;
  highlightEnabled: boolean;
  activeClip: ButtonPlaybackActive | null;
  clockBinding?: ClockBinding;
  onButtonTimeUpdate: (language: string, localTime: number) => void;
  onButtonStop: (language: string) => void;
  /** Effective playback speed (override ?? general ?? 1). */
  speed: number;
  /** Stored override value, or null when none is stored. */
  speedOverride: number | null;
  /** Course-level general speed for this language. */
  generalSpeed: number;
  /** Cycle handler; null clears the override. */
  onSpeedCycle?: (language: string, next: number | null) => void;
}

/**
 * One target-language answer row. The input VALUE is local state — a
 * keystroke re-renders only this row, not the parent card (whose `inputs`
 * map now changes only on submit/revert). Memoized: parents re-render on
 * cue changes and submissions; rows with unchanged props bail out.
 *
 * Rows are keyed by (cardId, language) in the parent, so local state resets
 * naturally on card advance.
 */
export const TargetLanguageInput = memo(function TargetLanguageInput({
  translation,
  audioUrl,
  wordTimings,
  state,
  targetAudioMode,
  autoPlayedRef,
  onSubmit,
  onRevert,
  onAudioPlay,
  submitLabel,
  placeholder,
  revertLabel,
  revertTooltip,
  showLanguageLabel,
  locale,
  inputRefsByLanguage,
  firstInputRef,
  autoFocus,
  isFirstTarget = false,
  allRevealed = false,
  showRomanization = true,
  highlightEnabled,
  activeClip,
  clockBinding,
  onButtonTimeUpdate,
  onButtonStop,
  speed,
  speedOverride,
  generalSpeed,
  onSpeedCycle,
}: TargetLanguageInputProps) {
  const isActive = activeClip?.language === translation.language;
  const t = useTranslations('LearningMode');
  const [showClean, setShowClean] = useState(false);
  const autoPlayAudioRef = useRef<HTMLAudioElement | null>(null);

  // The typed answer lives here, not in the parent — see component docs.
  const [value, setValue] = useState('');

  // A revert (submitted → false) clears the answer, matching the parent's
  // cleared map entry. Typing never touches parent state, so nothing else
  // can clobber the value mid-edit.
  useEffect(() => {
    if (!state.submitted) {
      setValue('');
      setShowClean(false);
    }
  }, [state.submitted]);

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
    audio.preservesPitch = true;
    const audioEl = audio as HTMLAudioElement & {
      webkitPreservesPitch?: boolean;
    };
    audioEl.webkitPreservesPitch = true;
    audio.playbackRate = speed;
    autoPlayAudioRef.current = audio;

    let raf = 0;
    const tick = () => {
      onButtonTimeUpdate(translation.language, audio.currentTime);
      raf = requestAnimationFrame(tick);
    };
    audio.onended = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      onButtonStop(translation.language);
    };
    audio
      .play()
      .then(() => {
        raf = requestAnimationFrame(tick);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') console.error('Auto-play failed:', err);
      });

    return () => {
      if (raf) cancelAnimationFrame(raf);
      audio.pause();
      audio.currentTime = 0;
      onButtonStop(translation.language);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.submitted, targetAudioMode, audioUrl, translation.language, autoPlayedRef, onButtonTimeUpdate, onButtonStop]);

  // Keep an already-running afterSubmit auto-play element in sync when `speed`
  // changes mid-playback. Mirrors the pattern in AudioButton; without this the
  // rate set at element creation is sticky for the life of that clip.
  useEffect(() => {
    if (autoPlayAudioRef.current) {
      autoPlayAudioRef.current.playbackRate = speed;
    }
  }, [speed]);

  useEffect(() => {
    return () => {
      autoPlayAudioRef.current?.pause();
    };
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !state.submitted) {
      e.preventDefault();
      onSubmit(translation.language, value);
    }
  };

  const languageDisplayName = showLanguageLabel
    ? getLocalizedLanguageNameByCode(translation.language, locale)
    : null;

  // Submitted rows render the committed text from the parent; unsubmitted
  // rows (reveal sweep) use the live local value.
  const displayText = state.submitted ? state.userText : value;
  const hasUserText = !!displayText.trim();

  const audioControls = (
    <div className="flex items-center">
      <AudioButton
        url={audioUrl}
        language={translation.language}
        onPlay={onAudioPlay}
        onTimeUpdate={onButtonTimeUpdate}
        onStop={onButtonStop}
        speed={speed}
      />
      {onSpeedCycle && (
        <CardSpeedBadge
          override={speedOverride}
          generalSpeed={generalSpeed}
          onCycle={(next) => onSpeedCycle(translation.language, next)}
        />
      )}
    </div>
  );

  if (allRevealed && !state.submitted) {
    return (
      <div
        className="space-y-1"
        {...(isFirstTarget ? { 'data-tutorial': 'target-input-full' } : {})}
      >
        {languageDisplayName ? (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {languageDisplayName}
            </span>
            {audioControls}
          </div>
        ) : (
          <div className="flex justify-end">{audioControls}</div>
        )}
        {hasUserText ? (
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <DiffDisplay
                expected={translation.text}
                actual={displayText}
                language={translation.language}
                hideAccuracy={false}
                hideErrors={showClean}
              />
            </div>
            <div className="flex shrink-0 gap-2 pt-0.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowClean((v) => !v)}
                    className={`h-9 w-9 shrink-0 ${showClean ? 'ring-2 ring-primary border-primary bg-primary/5' : ''}`}
                    aria-label={showClean ? t('showCorrections') : t('showSentence')}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {showClean ? t('showCorrections') : t('showSentence')}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : (
          <HighlightedText
            text={translation.text || '...'}
            language={translation.language}
            wordTimings={wordTimings}
            localTime={activeClip?.localTime ?? 0}
            clockBinding={isActive ? clockBinding : undefined}
            isActive={isActive}
            enabled={highlightEnabled}
            className="body-large text-muted-foreground"
          />
        )}
        {showRomanization && translation.romanization && (
          <p className="text-xs text-muted-foreground leading-tight">
            {translation.romanization}
          </p>
        )}
      </div>
    );
  }

  if (state.submitted) {
    return (
      <div
        className="space-y-1"
        {...(isFirstTarget ? { 'data-tutorial': 'target-input-full' } : {})}
      >
        {languageDisplayName ? (
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase">
              {languageDisplayName}
            </span>
            {audioControls}
          </div>
        ) : (
          <div className="flex justify-end">{audioControls}</div>
        )}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            {hasUserText ? (
              <DiffDisplay
                expected={translation.text}
                actual={displayText}
                language={translation.language}
                hideAccuracy={false}
                hideErrors={showClean}
              />
            ) : (
              <HighlightedText
                text={translation.text || '...'}
                language={translation.language}
                wordTimings={wordTimings}
                localTime={activeClip?.localTime ?? 0}
                clockBinding={isActive ? clockBinding : undefined}
                isActive={isActive}
                enabled={highlightEnabled}
                className="body-large text-muted-foreground"
              />
            )}
          </div>
          <div className="flex shrink-0 gap-2 pt-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => onRevert(translation.language)}
                  className="h-9 w-9 shrink-0"
                  aria-label={revertLabel}
                >
                  <Undo2 className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{revertTooltip}</TooltipContent>
            </Tooltip>
            {hasUserText && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => setShowClean((v) => !v)}
                    className={`h-9 w-9 shrink-0 ${showClean ? 'ring-2 ring-primary border-primary bg-primary/5' : ''}`}
                    aria-label={showClean ? t('showCorrections') : t('showSentence')}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {showClean ? t('showCorrections') : t('showSentence')}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
        {showRomanization && translation.romanization && (
          <p className="text-xs text-muted-foreground leading-tight">
            {translation.romanization}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="space-y-1"
      {...(isFirstTarget ? { 'data-tutorial': 'target-input-full' } : {})}
    >
      {languageDisplayName ? (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground uppercase">
            {languageDisplayName}
          </span>
          <AudioButton
            url={audioUrl}
            language={translation.language}
            onPlay={onAudioPlay}
            onTimeUpdate={onButtonTimeUpdate}
            onStop={onButtonStop}
          />
        </div>
      ) : (
        <div className="flex justify-end">
          <AudioButton
            url={audioUrl}
            language={translation.language}
            onPlay={onAudioPlay}
            onTimeUpdate={onButtonTimeUpdate}
            onStop={onButtonStop}
          />
        </div>
      )}
      <div
        className="flex items-center gap-2"
        {...(isFirstTarget ? { 'data-tutorial': 'target-input-and-submit' } : {})}
      >
        <Input
          ref={(el) => {
            inputRefsByLanguage.current[translation.language] = el;
            if (isFirstTarget) firstInputRef.current = el;
          }}
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="sentences"
          spellCheck={false}
          {...(isFirstTarget ? { 'data-testid': 'learn-translation-input' } : {})}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => onSubmit(translation.language, value)}
          className="h-9 w-9 shrink-0"
          aria-label={submitLabel}
          {...(isFirstTarget ? { 'data-tutorial': 'submit-answer', 'data-testid': 'learn-submit-translation' } : {})}
        >
          <Check className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
});
