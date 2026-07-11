'use client';

import { useCallback, useMemo } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { resolveAudioSettings, applyOnlyNewListening } from '@/lib/audio/mergeAudio';
import { DEFAULT_AUTO_PLAY } from '@/lib/constants/audioPlayback';
import type { LearningState } from './useLearningMode';

const alwaysFalse = () => false;

export interface UseLearningAudioOptions {
  /** When true, auto-advance after audio is disabled (e.g. during the audio tutorial). */
  disableAutoAdvance?: boolean;
  /** When true, audio does not start automatically (e.g. when the audio tutorial is about to start or is running). */
  disableAutoPlay?: boolean;
  /** Fires synchronously right before audio-mode auto-advance proceeds to
   *  the next card. The onboarding wrapper uses this to bump its
   *  `cardsRated` counter (which is what triggers staged coachmarks +
   *  lesson completion) on auto-advanced cards — without it those cards
   *  silently slip past the wizard's threshold and the tutorial stops
   *  firing past the first manual rating. */
  onAutoNext?: () => void;
}

export function useLearningAudio(
  state: LearningState,
  options: UseLearningAudioOptions = {},
) {
  const { disableAutoAdvance = false, disableAutoPlay = false, onAutoNext } = options;
  const cs =
    state.status === 'reviewing' ||
    state.status === 'noCardsDue' ||
    state.status === 'noCollection'
      ? state.courseSettings
      : null;

  const isReviewing = state.status === 'reviewing';
  // While the settings sheet is open the user is configuring playback, not
  // listening — never auto-start audio. This also stops changing the language
  // order (a composition change that would otherwise be treated as a fresh
  // "play this now" opportunity) from kicking off playback behind the sheet.
  const settingsOpen = state.settingsOpen;
  // Radio mode is intrinsically a hands-free playback queue, so it forces
  // autoplay + auto-advance regardless of the user's setting. `disableAutoPlay`
  // (e.g. while a tutorial is starting) still wins so we don't start audio at
  // the wrong moment.
  const isRadio = cs?.schedulingMode === 'radio';
  const reviewMode = cs?.reviewMode ?? 'audio';
  // Writing ("full") mode resolves its own playback settings, falling back to
  // the audio-mode values while a doc is unmigrated. Radio always uses the
  // audio set.
  const isFullMode = reviewMode !== 'audio' && !isRadio;
  const fullReviewTargetAudioMode = cs?.fullReviewTargetAudioMode ?? 'afterSubmit';
  // Transcribe: writing-mode variant where the target audio is the prompt —
  // the merged blob contains only the target group and the base stays silent.
  // It carries its own settings copy, chained `*Transcribe ?? *Full ?? audio`.
  const isTranscribe =
    isFullMode && (cs?.writingInputMode ?? 'translate') === 'transcribe';
  const autoPlay =
    disableAutoPlay || settingsOpen
      ? false
      : isRadio
        ? true
        : isTranscribe
          ? (cs?.autoPlayAudioTranscribe ??
            cs?.autoPlayAudioFull ??
            cs?.autoPlayAudio ??
            DEFAULT_AUTO_PLAY)
          : isFullMode
            ? (cs?.autoPlayAudioFull ?? cs?.autoPlayAudio ?? DEFAULT_AUTO_PLAY)
            : (cs?.autoPlayAudio ?? DEFAULT_AUTO_PLAY);

  const cardSpeedOverrides =
    state.status === 'reviewing' ? state.audioSpeedOverrides : undefined;
  // Per-card review counts for the "Only new" Practice-Listening limit. Active
  // reviews (preReviewCount + FSRS reps) are bumped in audio/full mode; radio
  // plays bump radioPlayCount instead, so radio counts max(active, radio).
  const cardReviewCount =
    state.status === 'reviewing'
      ? state.preReviewCount + (state.fsrsState?.reps ?? 0)
      : 0;
  const cardRadioReviewCount =
    state.status === 'reviewing' ? state.radioPlayCount : 0;
  const audioSettings = useMemo(() => {
    const resolved = resolveAudioSettings(
      cs,
      cardSpeedOverrides,
      isTranscribe ? 'transcribe' : isFullMode ? 'full' : 'audio',
    );
    // The "Practice Listening / Speaking" (target before/after base) toggles
    // only apply to the merged-audio practice path — audio review mode and
    // radio. Full (typing) review mode keeps the historical base→target
    // sequence regardless of the stored toggles. Full mode never auto-advances
    // (handleScheduleComplete below no-ops), so also drop the trailing
    // pause-before-advance silence from the merged blob.
    if (isFullMode) {
      return {
        ...resolved,
        playTargetBefore: false,
        playTargetAfter: true,
        autoAdvance: false,
      };
    }
    // "Only new": drop Practice Listening once this card has graduated past its
    // initial N reviews (counting radio plays in radio mode).
    return applyOnlyNewListening(resolved, {
      reviewCount: cardReviewCount,
      radioReviewCount: isRadio ? cardRadioReviewCount : undefined,
    });
  }, [
    cs,
    cardSpeedOverrides,
    isFullMode,
    isTranscribe,
    isRadio,
    cardReviewCount,
    cardRadioReviewCount,
  ]);

  const handleNextFromAudio = useCallback(() => {
    if (state.status === 'reviewing') state.handleNext();
  }, [state]);

  // In audio mode, auto-advance after schedule completes; in full mode, never
  // auto-advance. Radio mode forces auto-advance even if the user has it off
  // (radio is a continuous-playback queue and stalling on each card defeats
  // the point).
  const handleScheduleComplete = useCallback(() => {
    if (
      state.status === 'reviewing' &&
      reviewMode === 'audio' &&
      (audioSettings.autoAdvance || isRadio) &&
      !disableAutoAdvance
    ) {
      // Notify the auto-next consumer (e.g. onboarding wrapper's
      // `onCardRated`) BEFORE advancing so the snapshot is captured
      // against the just-completed card, not the next one.
      onAutoNext?.();
      state.handleNext();
    }
  }, [state, reviewMode, audioSettings.autoAdvance, isRadio, disableAutoAdvance, onAutoNext]);

  const resetReviewFlag = useCallback(() => {
    if (state.status === 'reviewing') state.resetReviewFlag();
  }, [state]);

  // In full review mode, only include target languages in merged audio
  // if the setting is 'always' — except transcribe, where the target IS the
  // prompt (and the base is dropped entirely). Otherwise, individual clips
  // are played per-language inside FullReviewCardContent.
  const includeTargetInMerge =
    reviewMode === 'audio' ||
    isTranscribe ||
    fullReviewTargetAudioMode === 'always';

  const audio = useAudioPlayer({
    cardId: isReviewing ? state.cardId : null,
    audioRecordings: isReviewing ? state.audioRecordings : [],
    nextCard: isReviewing ? state.nextCard : null,
    settings: audioSettings,
    orderedBase: isReviewing && !isTranscribe ? state.baseLanguages : [],
    orderedTarget: isReviewing && includeTargetInMerge ? state.targetLanguages : [],
    sourceText: isReviewing
      ? state.translations.filter((tr) => tr.isBaseLanguage).map((tr) => tr.text).filter(Boolean).join(' / ')
      : '',
    languageNames: isReviewing
      ? state.translations.filter((tr) => tr.isTargetLanguage).map((tr) => tr.text).filter(Boolean).join(' / ')
      : '',
    autoPlay,
    settingsOpen,
    getReviewInitiatedByThisTab: isReviewing
      ? state.getReviewInitiatedByThisTab
      : alwaysFalse,
    onScheduleComplete: handleScheduleComplete,
    onResetReviewFlag: resetReviewFlag,
    onNext: handleNextFromAudio,
  });

  const openSettings = useCallback(() => {
    audio.pause();
    state.setSettingsOpen(true);
  }, [audio, state]);

  return { audio, openSettings };
}
