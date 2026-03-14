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
}

export function useLearningAudio(
  state: LearningState,
  options: UseLearningAudioOptions = {},
) {
  const { disableAutoAdvance = false, disableAutoPlay = false } = options;
  const cs =
    state.status === 'reviewing' ||
    state.status === 'noCardsDue' ||
    state.status === 'noCollection'
      ? state.courseSettings
      : null;

  const isReviewing = state.status === 'reviewing';
  const autoPlay =
    disableAutoPlay ? false : (cs?.autoPlayAudio ?? DEFAULT_AUTO_PLAY);
  const reviewMode = cs?.reviewMode ?? 'audio';
  const fullReviewTargetAudioMode = cs?.fullReviewTargetAudioMode ?? 'afterSubmit';

  const audioSettings = useMemo(() => resolveAudioSettings(cs), [cs]);

  const handleNextFromAudio = useCallback(() => {
    if (state.status === 'reviewing') state.handleNext();
  }, [state]);

  // In audio mode, auto-advance after schedule completes; in full mode, never auto-advance
  const handleScheduleComplete = useCallback(() => {
    if (
      state.status === 'reviewing' &&
      reviewMode === 'audio' &&
      audioSettings.autoAdvance &&
      !disableAutoAdvance
    ) {
      state.handleNext();
    }
  }, [state, reviewMode, audioSettings.autoAdvance, disableAutoAdvance]);

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
