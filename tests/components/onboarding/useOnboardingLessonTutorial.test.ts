import { describe, it, expect } from 'vitest';
import {
  buildCoreSteps,
  buildModeSwitchSteps,
  buildCardActionsSteps,
  buildWordTapSteps,
  buildChatSteps,
} from '@/app/app/onboarding/components/useOnboardingLessonTutorial';
import type { TranslateFn } from '@/lib/tutorials/types';

/**
 * Build a translator that records every key lookup so the test can assert
 * exactly which i18n keys each stage queries.
 */
function makeMockTranslator(): TranslateFn & { calls: string[] } {
  const calls: string[] = [];
  const t = ((key: string) => {
    calls.push(key);
    return `t:${key}`;
  }) as TranslateFn & { calls: string[] };
  t.markup = (key: string) => {
    calls.push(`markup:${key}`);
    return `markup:${key}`;
  };
  t.calls = calls;
  return t;
}

describe('buildCoreSteps', () => {
  it('produces the audio-mode step set (welcome + card + reveal + audio controls + rating + auto-add + audio play)', () => {
    const t = makeMockTranslator();
    const steps = buildCoreSteps(t, 'audio');
    expect(steps).toHaveLength(7);
    expect(steps[0].popover?.title).toBe('t:core.welcomeAudio.title');
    expect(steps[1].element).toBe('[data-tutorial="card-flashcard"]');
    expect(steps[1].popover?.description).toBe('t:core.card.descriptionAudio');
    expect(steps[2].element).toBe('[data-tutorial="target-text-audio"]');
    expect(steps[3].element).toBe('[data-tutorial="audio-controls"]');
    expect(steps[4].element).toBe('[data-tutorial="rating-buttons"]');
    // Auto-add step has no element anchor — it's a centered modal.
    expect(steps[5].element).toBeUndefined();
    expect(steps[5].popover?.title).toBe('t:core.autoAdd.title');
    expect(steps[6].element).toBe('[data-tutorial="audio-play"]');
  });

  it('produces the full-mode step set (welcome + card + input + rating + auto-add)', () => {
    const t = makeMockTranslator();
    const steps = buildCoreSteps(t, 'full');
    expect(steps).toHaveLength(5);
    expect(steps[0].popover?.title).toBe('t:core.welcomeFull.title');
    expect(steps[1].popover?.description).toBe('t:core.card.descriptionFull');
    expect(steps[2].element).toBe('[data-tutorial="target-input-and-submit"]');
    expect(steps[3].element).toBe('[data-tutorial="rating-buttons"]');
    expect(steps[4].element).toBeUndefined();
    expect(steps[4].popover?.title).toBe('t:core.autoAdd.title');
  });

  it('swaps the card + input copy for the transcribe writing style', () => {
    const t = makeMockTranslator();
    const steps = buildCoreSteps(t, 'full', true);
    expect(steps[1].popover?.description).toBe(
      't:core.card.descriptionFullTranscribe',
    );
    const input = steps.find(
      (s) => s.element === '[data-tutorial="target-input-and-submit"]',
    );
    expect(input?.popover?.title).toBe('t:core.inputTranscribe.title');
    expect(input?.popover?.description).toBe(
      't:core.inputTranscribe.description',
    );
  });

  it('keeps the translate copy when transcribe is off', () => {
    const t = makeMockTranslator();
    const steps = buildCoreSteps(t, 'full', false);
    const input = steps.find(
      (s) => s.element === '[data-tutorial="target-input-and-submit"]',
    );
    expect(input?.popover?.title).toBe('t:core.input.title');
  });

  it('uses t.markup with the audio-mode key for the rating description', () => {
    const t = makeMockTranslator();
    const steps = buildCoreSteps(t, 'audio');
    const rating = steps.find((s) => s.element === '[data-tutorial="rating-buttons"]');
    expect(rating?.popover?.description).toBe('markup:core.rating.descriptionAudio');
    expect(t.calls).toContain('markup:core.rating.descriptionAudio');
  });

  it('uses t.markup with the full-mode key for the rating description', () => {
    const t = makeMockTranslator();
    const steps = buildCoreSteps(t, 'full');
    const rating = steps.find((s) => s.element === '[data-tutorial="rating-buttons"]');
    expect(rating?.popover?.description).toBe('markup:core.rating.descriptionFull');
    expect(t.calls).toContain('markup:core.rating.descriptionFull');
  });

  it('falls back to plain t() when the translator lacks .markup', () => {
    const calls: string[] = [];
    const plain = ((key: string) => {
      calls.push(key);
      return `t:${key}`;
    }) as TranslateFn;
    // Note: no .markup property set
    const steps = buildCoreSteps(plain, 'audio');
    const rating = steps.find((s) => s.element === '[data-tutorial="rating-buttons"]');
    expect(rating?.popover?.description).toBe('t:core.rating.descriptionAudio');
  });

  it('queries each step title and description through the translator', () => {
    const t = makeMockTranslator();
    buildCoreSteps(t, 'audio');
    // Core audio mode hits 6 step titles + descriptions = 11 lookups (welcome has only title+description = 2, others have 2 each).
    expect(t.calls).toContain('core.welcomeAudio.title');
    expect(t.calls).toContain('core.welcomeAudio.description');
    expect(t.calls).toContain('core.card.title');
    expect(t.calls).toContain('core.card.descriptionAudio');
    expect(t.calls).toContain('core.reveal.title');
    expect(t.calls).toContain('core.audioControls.title');
    expect(t.calls).toContain('core.audioPlay.title');
    expect(t.calls).toContain('core.rating.title');
  });
});

describe('buildModeSwitchSteps', () => {
  it('produces the audio diff (welcome + reveal + audio controls + rating + audio play) — skips card overview + auto-add', () => {
    const t = makeMockTranslator();
    const steps = buildModeSwitchSteps(t, 'audio');
    expect(steps).toHaveLength(5);
    expect(steps[0].popover?.title).toBe('t:modeSwitch.audio.welcome.title');
    expect(steps[1].element).toBe('[data-tutorial="target-text-audio"]');
    expect(steps[2].element).toBe('[data-tutorial="audio-controls"]');
    expect(steps[3].element).toBe('[data-tutorial="rating-buttons"]');
    expect(steps[4].element).toBe('[data-tutorial="audio-play"]');
  });

  it('produces the full diff (welcome + input + rating) — skips card overview + auto-add', () => {
    const t = makeMockTranslator();
    const steps = buildModeSwitchSteps(t, 'full');
    expect(steps).toHaveLength(3);
    expect(steps[0].popover?.title).toBe('t:modeSwitch.full.welcome.title');
    expect(steps[1].element).toBe('[data-tutorial="target-input-and-submit"]');
    expect(steps[2].element).toBe('[data-tutorial="rating-buttons"]');
  });

  it('swaps the input copy for the transcribe writing style', () => {
    const t = makeMockTranslator();
    const steps = buildModeSwitchSteps(t, 'full', true);
    const input = steps.find(
      (s) => s.element === '[data-tutorial="target-input-and-submit"]',
    );
    expect(input?.popover?.title).toBe('t:core.inputTranscribe.title');
  });

  it('reuses the mode-specific rating markup key', () => {
    const t = makeMockTranslator();
    const stepsAudio = buildModeSwitchSteps(t, 'audio');
    const stepsFull = buildModeSwitchSteps(t, 'full');
    const ratingAudio = stepsAudio.find((s) => s.element === '[data-tutorial="rating-buttons"]');
    const ratingFull = stepsFull.find((s) => s.element === '[data-tutorial="rating-buttons"]');
    expect(ratingAudio?.popover?.description).toBe('markup:core.rating.descriptionAudio');
    expect(ratingFull?.popover?.description).toBe('markup:core.rating.descriptionFull');
  });
});

describe('buildCardActionsSteps', () => {
  it('emits one step anchored on the card-actions coachmark', () => {
    const t = makeMockTranslator();
    const steps = buildCardActionsSteps(t);
    expect(steps).toHaveLength(1);
    expect(steps[0].element).toBe('[data-coachmark-anchor="card-actions"]');
    expect(steps[0].popover?.title).toBe('t:cardActions.title');
    expect(steps[0].popover?.description).toBe('t:cardActions.description');
  });
});

describe('buildWordTapSteps', () => {
  it('emits a single word-tap coachmark anchored on the longest word', () => {
    const t = makeMockTranslator();
    const steps = buildWordTapSteps(t);
    expect(steps).toHaveLength(1);
    expect(steps[0].element).toBe('[data-coachmark-anchor="word-tap"]');
    expect(steps[0].popover?.title).toBe('t:wordTap.title');
  });
});

describe('buildChatSteps', () => {
  it('emits a single chat coachmark — split off from word-tap so it fires three reviews later', () => {
    const t = makeMockTranslator();
    const steps = buildChatSteps(t);
    expect(steps).toHaveLength(1);
    expect(steps[0].element).toContain('chat-button');
    expect(steps[0].popover?.title).toBe('t:chat.title');
  });
});
