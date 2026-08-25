import { describe, expect, it } from 'vitest';
import { needsFuriganaBackfill } from '../../migrations';

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
