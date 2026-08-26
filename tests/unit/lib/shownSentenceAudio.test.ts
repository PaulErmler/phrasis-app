import { describe, it, expect } from 'vitest';
import { audioUrlForShownSentence } from '@/components/app/learning/shownSentenceAudio';

const PRIMARY = 'https://cdn.example/primary.mp3';
const ALT = 'https://cdn.example/alt.mp3';

describe('audioUrlForShownSentence', () => {
  const accepted = [
    { text: 'Alles gut, mach dir keine Sorgen.', audioUrl: PRIMARY },
    { text: 'Das ist okay, sorge dich nicht.', audioUrl: ALT },
  ];

  it('plays the primary clip when the card sentence is on screen', () => {
    expect(
      audioUrlForShownSentence(
        'Alles gut, mach dir keine Sorgen.',
        'Alles gut, mach dir keine Sorgen.',
        PRIMARY,
        accepted,
      ),
    ).toBe(PRIMARY);
  });

  it('plays the alternative clip when that sentence is on screen', () => {
    expect(
      audioUrlForShownSentence(
        'Das ist okay, sorge dich nicht.',
        'Alles gut, mach dir keine Sorgen.',
        PRIMARY,
        accepted,
      ),
    ).toBe(ALT);
  });

  it('does not fall back to the primary clip while alternative audio is still generating', () => {
    expect(
      audioUrlForShownSentence(
        'Das ist okay, sorge dich nicht.',
        'Alles gut, mach dir keine Sorgen.',
        PRIMARY,
        [{ text: 'Das ist okay, sorge dich nicht.' }],
      ),
    ).toBeNull();
  });

  it('falls back to the primary clip when the shown sentence is not an accepted phrasing (unstored grader correction)', () => {
    expect(
      audioUrlForShownSentence(
        'Eso no es una respuesta aceptada.',
        'Alles gut, mach dir keine Sorgen.',
        PRIMARY,
        accepted,
      ),
    ).toBe(PRIMARY);
  });

  it('matches the stored alternative when punctuation differs from the shown sentence', () => {
    expect(
      audioUrlForShownSentence(
        'Das ist okay , sorge dich nicht.',
        'Alles gut, mach dir keine Sorgen.',
        PRIMARY,
        accepted,
      ),
    ).toBe(ALT);
  });
});
