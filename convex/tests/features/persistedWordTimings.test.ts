import { describe, expect, it } from 'vitest';
import { persistedWordTimings } from '../../features/ttsProcessing';

const timings = [{ word: 'salom', start: 0, end: 0.4 }];

describe('persistedWordTimings', () => {
  it('keeps timings only with validated audio', () => {
    expect(persistedWordTimings(true, timings)).toEqual(timings);
    expect(persistedWordTimings(false, timings)).toBeUndefined();
  });

  it('stores no timings for a backend that has none, so the gap stays visible', () => {
    // Gemini STT (Uzbek) reports `[]`; persisting that would read as "timed"
    // to the karaoke gate and the backfill forever.
    expect(persistedWordTimings(true, [])).toBeUndefined();
    expect(persistedWordTimings(true, undefined)).toBeUndefined();
  });
});
