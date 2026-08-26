'use client';

import { useCallback, useMemo } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import {
  resolveAudioSettings,
  resolveModeSetting,
  applyOnlyNewListening,
  type AudioSettingsMode,
} from '@/lib/audio/mergeAudio';
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
   *  lesson completion) on auto-advanced cards, without it those cards
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
  // listening, never auto-start audio. This also stops changing the language
  // order (a composition change that would otherwise be treated as a fresh
  // "play this now" opportunity) from kicking off playback behind the sheet.
  const settingsOpen = state.settingsOpen;
  // Free play ('radio') is one mode with two faces, picked by the review mode:
  // Shadowing gives Radio, an intrinsically hands-free playback queue that
  // forces autoplay + auto-advance regardless of the user's setting; Writing
  // gives Free Study, which stays user-paced like any other typing session.
  // `disableAutoPlay` (e.g. while a tutorial is starting) still wins so we
  // don't start audio at the wrong moment.
  const isFreePlay = cs?.schedulingMode === 'radio';
  const reviewMode = cs?.reviewMode ?? 'audio';
  const isHandsFree = isFreePlay && reviewMode === 'audio';
  // Writing ("full") mode resolves its own playback settings, falling back to
  // the audio-mode values while a doc is unmigrated, including in free play's
  // writing face, which is a typing session and must not borrow Radio's
  // listening settings.
  const isFullMode = reviewMode !== 'audio';
  const fullReviewTargetAudioMode = cs?.fullReviewTargetAudioMode ?? 'afterSubmit';
  // Transcribe: writing-mode variant where the target audio is the prompt.
  // The merged blob contains only the target group and the base stays silent.
  // It carries its own settings copy, chained `*Transcribe ?? *Full ?? audio`.
  const isTranscribe =
    isFullMode && (cs?.writingInputMode ?? 'translate') === 'transcribe';
  const settingsMode: AudioSettingsMode = isTranscribe
    ? 'transcribe'
    : isFullMode
      ? 'full'
      : 'audio';
  // The user's mode-resolved auto-play setting, before the disable gates.
  // Also returned to callers that need to re-trigger playback after a gate
  // releases (e.g. a tutorial popover being dismissed).
  const userAutoPlay = isHandsFree
    ? true
    : (resolveModeSetting(cs, 'autoPlayAudio', settingsMode) ??
      DEFAULT_AUTO_PLAY);
  const autoPlay = disableAutoPlay || settingsOpen ? false : userAutoPlay;

  const cardSpeedOverrides =
    state.status === 'reviewing' ? state.audioSpeedOverrides : undefined;
  // Per-card review counts for the "Only new" Practice-Listening limit. Active
  // reviews (preReviewCount + FSRS reps) are bumped in audio/full mode; radio
  // plays bump radioPlayCount instead, so the listening face counts
  // max(active, radio).
  const cardReviewCount =
    state.status === 'reviewing'
      ? state.preReviewCount + (state.fsrsState?.reps ?? 0)
      : 0;
  const cardRadioReviewCount =
    state.status === 'reviewing' ? state.radioPlayCount : 0;
  const cardGoodReviewCount =
    state.status === 'reviewing' ? state.goodReviewCount : 0;
  const audioSettings = useMemo(() => {
    const resolved = resolveAudioSettings(cs, cardSpeedOverrides, settingsMode);
    // The "Practice Listening / Speaking" (target before/after base) toggles
    // only apply to the merged-audio practice path. Audio review mode and
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
    // Graduate the card out of Practice Listening per the configured strategy:
    // "only new" (initial N reviews, counting radio plays in the listening
    // face) or "until rated good" (N FSRS good/easy ratings).
    return applyOnlyNewListening(resolved, {
      reviewCount: cardReviewCount,
      radioReviewCount: isHandsFree ? cardRadioReviewCount : undefined,
      goodReviewCount: cardGoodReviewCount,
    });
  }, [
    cs,
    cardSpeedOverrides,
    isFullMode,
    settingsMode,
    isHandsFree,
    cardReviewCount,
    cardRadioReviewCount,
    cardGoodReviewCount,
  ]);

  const handleNextFromAudio = useCallback(() => {
    if (state.status === 'reviewing') state.handleNext();
  }, [state]);

  // In audio mode, auto-advance after schedule completes; in full mode, never
  // auto-advance. Free play's listening face forces auto-advance even if the
  // user has it off (Radio is a continuous-playback queue and stalling on
  // each card defeats the point); its writing face does not.
  const handleScheduleComplete = useCallback(() => {
    if (
      state.status === 'reviewing' &&
      reviewMode === 'audio' &&
      (audioSettings.autoAdvance || isHandsFree) &&
      !disableAutoAdvance
    ) {
      // Notify the auto-next consumer (e.g. onboarding wrapper's
      // `onCardRated`) BEFORE advancing so the snapshot is captured
      // against the just-completed card, not the next one.
      onAutoNext?.();
      state.handleNext();
    }
  }, [state, reviewMode, audioSettings.autoAdvance, isHandsFree, disableAutoAdvance, onAutoNext]);

  const resetReviewFlag = useCallback(() => {
    if (state.status === 'reviewing') state.resetReviewFlag();
  }, [state]);

  // In full review mode, only include target languages in merged audio
  // if the setting is 'always', except transcribe, where the target IS the
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

  return { audio, openSettings, userAutoPlay };
}
