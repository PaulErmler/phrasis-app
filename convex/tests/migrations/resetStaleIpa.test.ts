import { describe, expect, it } from 'vitest';
import { resetStaleIpaPatch } from '../../migrations';
import { getIpaSource } from '../../lib/textAnnotations';

/**
 * The reset sweep does two jobs at once, and the second is the reason it
 * exists: it regenerates rows written before a post-processing change, and it
 * purges rows for the languages that lost their `ipaVoice` in Sep 2026.
 * Those languages never come back through the lazy path, so without this the
 * mangled Thai and Hebrew transcriptions would sit in the database forever,
 * merely hidden at the projection.
 */

const STALE = 'espeak-ng-emscripten-0.3.5-v1';
const CLEARED = { ipaText: undefined, ipaSource: undefined };

describe('resetStaleIpaPatch (migrateOne logic)', () => {
  it('clears rows written by a stale engine version', () => {
    expect(
      resetStaleIpaPatch({
        language: 'de',
        ipaText: 'hˈaloː',
        ipaSource: STALE,
      }),
    ).toEqual(CLEARED);
  });

  it('clears the failure sentinel too, so the new engine gets one retry', () => {
    expect(
      resetStaleIpaPatch({ language: 'de', ipaText: '', ipaSource: STALE }),
    ).toEqual(CLEARED);
  });

  it('clears rows for a language that has lost its espeak voice', () => {
    // Nothing refills these: `th` is no longer in IPA_LANGUAGES, so the lazy
    // pipeline skips it. Clearing is how the bad value actually leaves.
    expect(
      resetStaleIpaPatch({
        language: 'th',
        ipaText: 'sˈa5wmsaɜds',
        ipaSource: STALE,
      }),
    ).toEqual(CLEARED);
  });

  it('leaves current-version rows alone (no re-annotation storm)', () => {
    expect(
      resetStaleIpaPatch({
        language: 'de',
        ipaText: 'hˈaloː',
        ipaSource: getIpaSource('de'),
      }),
    ).toBeUndefined();
    // Including the sentinel: the current engine has already tried and failed.
    expect(
      resetStaleIpaPatch({
        language: 'de',
        ipaText: '',
        ipaSource: getIpaSource('de'),
      }),
    ).toBeUndefined();
  });

  it('leaves never-attempted rows as never-attempted', () => {
    // `undefined` already means "a scheduler should enqueue this". Patching it
    // to undefined again would be a write for no reason on every row.
    expect(resetStaleIpaPatch({ language: 'de' })).toBeUndefined();
    expect(
      resetStaleIpaPatch({ language: 'de', ipaSource: STALE }),
    ).toBeUndefined();
  });

  it('clears rows that predate the source field entirely', () => {
    // Rows written before `ipaSource` existed carry a value and no tag; an
    // absent tag is not the current tag, so they are stale by definition.
    expect(resetStaleIpaPatch({ language: 'de', ipaText: 'hˈaloː' })).toEqual(
      CLEARED,
    );
  });

  it('reads the language from either table', () => {
    // `texts` has `language`, `translations` has `targetLanguage`. Both must
    // resolve, since getIpaSource takes the language and a future per-language
    // source would otherwise compare against the wrong engine tag.
    expect(
      resetStaleIpaPatch({
        targetLanguage: 'de',
        ipaText: 'hˈaloː',
        ipaSource: getIpaSource('de'),
      }),
    ).toBeUndefined();
    expect(
      resetStaleIpaPatch({
        targetLanguage: 'de',
        ipaText: 'hˈaloː',
        ipaSource: STALE,
      }),
    ).toEqual(CLEARED);
  });
});
