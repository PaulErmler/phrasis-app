import { describe, it, expect } from 'vitest';
import { getCompareConfig, toDiffOptions } from '@/lib/textCompare/languageConfig';

describe('getCompareConfig', () => {
  it('returns defaults for unknown languages', () => {
    const cfg = getCompareConfig('xx-unknown');
    expect(cfg.locale).toBe('en');
    expect(cfg.hasWordBoundaries).toBe(true);
    expect(cfg.foldCase).toBe(false);
    expect(cfg.foldDiacritics).toBe(false);
    expect(cfg.collapseWhitespace).toBe(true);
  });

  it('returns correct locale for supported languages', () => {
    expect(getCompareConfig('de').locale).toBe('de');
    expect(getCompareConfig('es').locale).toBe('es');
    expect(getCompareConfig('fr').locale).toBe('fr');
  });

  it('flags zh/ja/th as languages without word boundaries', () => {
    expect(getCompareConfig('zh').hasWordBoundaries).toBe(false);
    expect(getCompareConfig('ja').hasWordBoundaries).toBe(false);
    expect(getCompareConfig('th').hasWordBoundaries).toBe(false);
  });

  it('keeps word boundaries enabled for typical languages', () => {
    expect(getCompareConfig('en').hasWordBoundaries).toBe(true);
    expect(getCompareConfig('ko').hasWordBoundaries).toBe(true);
  });
});

describe('toDiffOptions', () => {
  it('strips hasWordBoundaries from the config', () => {
    const cfg = getCompareConfig('zh');
    const diff = toDiffOptions(cfg);
    expect('hasWordBoundaries' in diff).toBe(false);
    expect(diff.locale).toBe('zh');
  });

  it('keeps all other diff fields intact', () => {
    const cfg = getCompareConfig('en');
    const diff = toDiffOptions(cfg);
    expect(diff.locale).toBe('en');
    expect(diff.foldCase).toBe(false);
    expect(diff.collapseWhitespace).toBe(true);
  });
});
