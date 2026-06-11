'use client';

import { useCallback, useMemo } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { resolveAudioSettings } from '@/lib/audio/mergeAudio';
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
  const autoPlay =
    disableAutoPlay || settingsOpen
      ? false
      : isRadio
        ? true
        : (cs?.autoPlayAudio ?? DEFAULT_AUTO_PLAY);
  const reviewMode = cs?.reviewMode ?? 'audio';
  const fullReviewTargetAudioMode = cs?.fullReviewTargetAudioMode ?? 'afterSubmit';

  const cardSpeedOverrides =
    state.status === 'reviewing' ? state.audioSpeedOverrides : undefined;
  const audioSettings = useMemo(() => {
    const resolved = resolveAudioSettings(cs, cardSpeedOverrides);
    // The "Practice Listening / Speaking" (target before/after base) toggles
    // only apply to the merged-audio practice path — audio review mode and
    // radio. Full (typing) review mode keeps the historical base→target
    // sequence regardless of the stored toggles.
    if (reviewMode !== 'audio' && !isRadio) {
      return { ...resolved, playTargetBefore: false, playTargetAfter: true };
    }
    return resolved;
  }, [cs, cardSpeedOverrides, reviewMode, isRadio]);

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
  // if the setting is 'always'. Otherwise, individual clips are played
  // per-language inside FullReviewCardContent.
  const includeTargetInMerge =
    reviewMode === 'audio' || fullReviewTargetAudioMode === 'always';

  const audio = useAudioPlayer({
    cardId: isReviewing ? state.cardId : null,
    audioRecordings: isReviewing ? state.audioRecordings : [],
    nextCard: isReviewing ? state.nextCard : null,
    settings: audioSettings,
    orderedBase: isReviewing ? state.baseLanguages : [],
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
