import { describe, it, expect } from 'vitest';
import { validateRows } from '@/components/app/import-texts/useImportValidation';
import { MAX_CARD_TEXT_LENGTH } from '@/lib/constants/learning';

const courseLanguages = ['de', 'es'];

function baseOpts(overrides: Partial<Parameters<typeof validateRows>[0]> = {}) {
  return {
    rows: [
      ['Guten Morgen', 'Buenos días'],
      ['Wie geht es dir?', '¿Cómo estás?'],
    ],
    mapping: { de: 0, es: 1 },
    courseLanguages,
    quotaBalance: 100,
    quotaUnlimited: false,
    hasHeader: false,
    ...overrides,
  };
}

describe('validateRows', () => {
  it('flags missing mapping as mappingComplete=false', () => {
    const r = validateRows(baseOpts({ mapping: { de: 0 } }));
    expect(r.mappingComplete).toBe(false);
    expect(r.canImport).toBe(false);
  });

  it('returns valid statuses when mapping is complete and rows are clean', () => {
    const r = validateRows(baseOpts());
    expect(r.mappingComplete).toBe(true);
    expect(r.validCount).toBe(2);
    expect(r.errorCount).toBe(0);
    expect(r.canImport).toBe(true);
    expect(r.statuses[0].kind).toBe('valid');
  });

  it('flags over-length cells', () => {
    const long = 'x'.repeat(MAX_CARD_TEXT_LENGTH + 1);
    const r = validateRows(baseOpts({ rows: [[long, 'Hola']] }));
    expect(r.errorCount).toBe(1);
    const s = r.statuses[0];
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(s.reasons[0].code).toBe('TOO_LONG');
    }
  });

  it('treats length exactly MAX_CARD_TEXT_LENGTH as valid', () => {
    const atMax = 'y'.repeat(MAX_CARD_TEXT_LENGTH);
    const r = validateRows(baseOpts({ rows: [[atMax, 'Hola']] }));
    expect(r.validCount).toBe(1);
    expect(r.errorCount).toBe(0);
  });

  it('flags empty mapped cells', () => {
    const r = validateRows(baseOpts({ rows: [['Hallo', '']] }));
    expect(r.errorCount).toBe(1);
    const s = r.statuses[0];
    if (s.kind === 'error') {
      expect(s.reasons.some((x) => x.code === 'EMPTY_CELL')).toBe(true);
    }
  });

  it('classifies duplicates as warnings (still importable)', () => {
    const r = validateRows(
      baseOpts({
        rows: [
          ['Hallo', 'Hola'],
          ['  Hallo  ', 'Hola de nuevo'],
        ],
      }),
    );
    expect(r.statuses[0].kind).toBe('valid');
    const s = r.statuses[1];
    expect(s.kind).toBe('warning');
    if (s.kind === 'warning') {
      expect(s.reasons[0].code).toBe('DUPLICATE_IN_FILE');
    }
    expect(r.warningCount).toBe(1);
    expect(r.errorCount).toBe(0);
    expect(r.importableCount).toBe(2);
    expect(r.canImport).toBe(true);
  });

  it('skips the header row when hasHeader=true', () => {
    const r = validateRows(
      baseOpts({
        rows: [
          ['German', 'Spanish'],
          ['Hallo', 'Hola'],
        ],
        hasHeader: true,
      }),
    );
    expect(r.validCount).toBe(1);
    expect(r.statuses).toHaveLength(1);
  });

  it('quotaSufficient=false blocks import when importable rows exceed balance', () => {
    const r = validateRows(baseOpts({ quotaBalance: 1 }));
    expect(r.importableCount).toBe(2);
    expect(r.quotaSufficient).toBe(false);
    expect(r.canImport).toBe(false);
  });

  it('quotaUnlimited=true bypasses balance check', () => {
    const r = validateRows(baseOpts({ quotaBalance: 0, quotaUnlimited: true }));
    expect(r.quotaSufficient).toBe(true);
    expect(r.canImport).toBe(true);
  });

  it('handles ragged rows by treating missing cells as empty', () => {
    const r = validateRows(baseOpts({ rows: [['Hallo']] }));
    const s = r.statuses[0];
    expect(s.kind).toBe('error');
    if (s.kind === 'error') {
      expect(
        s.reasons.some((x) => x.code === 'EMPTY_CELL' && x.language === 'es'),
      ).toBe(true);
    }
  });
});
