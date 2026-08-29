import { describe, expect, it } from 'vitest';
import {
  needsFuriganaBackfill,
  resetStaleFuriganaPatch,
} from '../../migrations';
import { getFuriganaSource } from '../../lib/textAnnotations';

describe('needsFuriganaBackfill (migrateOne predicate)', () => {
  it('selects never-attempted Japanese rows with text', () => {
    expect(needsFuriganaBackfill('ja', undefined, '毎朝七時に起きます。')).toBe(
      true,
    );
  });

  it('honours the empty-string failure sentinel (never re-attempts)', () => {
    expect(needsFuriganaBackfill('ja', '', 'ひらがなだけ。')).toBe(false);
  });

  it('skips rows already annotated', () => {
    expect(needsFuriganaBackfill('ja', '毎朝[まいあさ]', '毎朝')).toBe(false);
  });

  it('skips translation slots whose text has not landed yet', () => {
    expect(needsFuriganaBackfill('ja', undefined, '')).toBe(false);
  });

  it('ignores non-Japanese rows', () => {
    expect(needsFuriganaBackfill('de', undefined, 'Guten Morgen')).toBe(false);
    expect(needsFuriganaBackfill('zh', undefined, '早上好')).toBe(false);
  });
});

describe('resetStaleFuriganaPatch (migrateOne logic)', () => {
  it('clears rows written by a stale engine version, sentinels included', () => {
    // A failure under the old engine deserves one retry under the new one.
    expect(
      resetStaleFuriganaPatch({
        furiganaText: '',
        furiganaSource: 'lindera-ipadic-2.0.0-v1',
      }),
    ).toEqual({ furiganaText: undefined, furiganaSource: undefined });
    expect(
      resetStaleFuriganaPatch({
        furiganaText: '毎朝[まいあさ]起きます。',
        furiganaSource: 'lindera-ipadic-2.0.0-v1',
      }),
    ).toEqual({ furiganaText: undefined, furiganaSource: undefined });
  });

  it('leaves current-version rows (guards against a re-annotation storm)', () => {
    expect(
      resetStaleFuriganaPatch({
        furiganaText: '毎朝[まいあさ]起きます。',
        furiganaSource: getFuriganaSource('ja'),
      }),
    ).toBeUndefined();
    // Current-version sentinel stays too: the current engine already tried.
    expect(
      resetStaleFuriganaPatch({
        furiganaText: '',
        furiganaSource: getFuriganaSource('ja'),
      }),
    ).toBeUndefined();
  });

  it('leaves never-attempted rows for the scheduler (idempotent re-run)', () => {
    expect(resetStaleFuriganaPatch({})).toBeUndefined();
  });
});
