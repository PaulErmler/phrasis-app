import { describe, expect, it } from 'vitest';
import type { Id } from '../../_generated/dataModel';
import { mixedDialectPinPatch } from '../../migrations';
import { resolveMixedVariant } from '../../../lib/languages';

const textId = 'texts:abc' as Id<'texts'>;

describe('mixedDialectPinPatch', () => {
  it('stamps a legacy es_mixed row with the translator coin', () => {
    expect(
      mixedDialectPinPatch({ textId, targetLanguage: 'es_mixed' }),
    ).toEqual({
      regionVariant: resolveMixedVariant('es_mixed', textId)!.regionVariant,
    });
  });

  it('leaves stamped rows and non-mixed languages alone', () => {
    expect(
      mixedDialectPinPatch({
        textId,
        targetLanguage: 'es_mixed',
        regionVariant: 'es-US',
      }),
    ).toBeUndefined();
    expect(
      mixedDialectPinPatch({ textId, targetLanguage: 'de' }),
    ).toBeUndefined();
    expect(
      mixedDialectPinPatch({ textId, targetLanguage: 'en_gb' }),
    ).toBeUndefined();
  });
});
