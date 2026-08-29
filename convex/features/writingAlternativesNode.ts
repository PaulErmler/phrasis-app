'use node';

import { v } from 'convex/values';
import { internalAction } from '../_generated/server';
import { internal } from '../_generated/api';
import {
  FURIGANA_LANGUAGES,
  IPA_LANGUAGES,
  ROMANIZATION_LANGUAGES,
} from '../../lib/languages';
import { romanizeText } from './translation';
import { ipaForText } from './ipa';
import { furiganaForText } from './furigana';
import type { AlternativeContext } from './writingAlternatives';

/**
 * Annotations for one stored writing alternative (romanization + IPA +
 * furigana in a single pass). Node runtime: espeak-ng and lindera are
 * Node-only; romanization piggybacks so an alternative needs exactly one
 * annotation hop. Same tri-state contract as translations rows: a kind that
 * throws is stored as the '' failure sentinel rather than retried — an
 * alternative without romanization is display-degraded, not broken.
 */
export const generateAlternativeAnnotations = internalAction({
  args: { alternativeId: v.id('writingAlternatives') },
  returns: v.null(),
  handler: async (ctx, { alternativeId }) => {
    const context: AlternativeContext = await ctx.runQuery(
      internal.features.writingAlternatives.getAlternativeContext,
      { alternativeId },
    );
    if (!context) return null; // evicted before we ran

    const { text, language } = context;
    const attempt = async (
      supported: boolean,
      generate: () => Promise<string>,
    ): Promise<string | undefined> => {
      if (!supported) return undefined;
      try {
        return await generate();
      } catch (error) {
        console.error(
          `writingAlternatives: annotation failed for ${language}`,
          error,
        );
        return '';
      }
    };

    const [romanizedText, ipaText, furiganaText] = await Promise.all([
      attempt(ROMANIZATION_LANGUAGES.has(language), () =>
        romanizeText(text, language),
      ),
      attempt(IPA_LANGUAGES.has(language), () => ipaForText(text, language)),
      attempt(FURIGANA_LANGUAGES.has(language), () =>
        furiganaForText(text, language),
      ),
    ]);

    await ctx.runMutation(
      internal.features.writingAlternatives.storeAlternativeAnnotations,
      {
        alternativeId,
        ...(romanizedText !== undefined ? { romanizedText } : {}),
        ...(ipaText !== undefined ? { ipaText } : {}),
        ...(furiganaText !== undefined ? { furiganaText } : {}),
      },
    );
    return null;
  },
});
