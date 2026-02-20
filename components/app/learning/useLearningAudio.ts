'use client';

import { useCallback, useMemo } from 'react';
import { useAudioPlayer } from '@/hooks/use-audio-player';
import { resolveAudioSettings } from '@/lib/audio/mergeAudio';
import { DEFAULT_AUTO_PLAY } from '@/lib/constants/audioPlayback';
import type { LearningState } from './useLearningMode';

const alwaysFalse = () => false;

export function useLearningAudio(state: LearningState) {
  const cs =
    state.status === 'reviewing' ||
    state.status === 'noCardsDue' ||
    state.status === 'noCollection'
      ? state.courseSettings
      : null;

  const isReviewing = state.status === 'reviewing';
  const autoPlay = cs?.autoPlayAudio ?? DEFAULT_AUTO_PLAY;

  const audioSettings = useMemo(() => resolveAudioSettings(cs), [cs]);

  const handleNextFromAudio = useCallback(() => {
    if (state.status === 'reviewing') state.handleNext();
  }, [state]);

  const handleScheduleComplete = useCallback(() => {
    if (state.status === 'reviewing' && audioSettings.autoAdvance) state.handleNext();
  }, [state, audioSettings.autoAdvance]);

  const resetReviewFlag = useCallback(() => {
    if (state.status === 'reviewing') state.resetReviewFlag();
  }, [state]);

  const audio = useAudioPlayer({
    cardId: isReviewing ? state.cardId : null,
    audioRecordings: isReviewing ? state.audioRecordings : [],
    settings: audioSettings,
    orderedBase: isReviewing ? state.baseLanguages : [],
    orderedTarget: isReviewing ? state.targetLanguages : [],
    sourceText: isReviewing ? state.sourceText : '',
    languageNames: isReviewing
      ? state.translations.map((tr) => tr.text).filter(Boolean).join(' / ')
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
