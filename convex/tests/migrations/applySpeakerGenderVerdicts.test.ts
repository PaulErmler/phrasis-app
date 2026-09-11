/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema from '../../schema';
import type { Id } from '../../_generated/dataModel';
import { applySpeakerGenderVerdictsToDataset } from '../../migrations';
import { SPEAKER_GENDER_VERDICTS } from '../../lib/speakerGenderVerdicts';
import {
  SPEAKER_GENDER_CHECK_SOURCE,
  SPEAKER_GENDER_SCAN_SOURCE,
} from '../../../lib/speakerGenderPrompt';

const modules = import.meta.glob('/convex/**/*.ts');

// The migrateOne logic runs directly against a convex-test db, like the
// other migration suites (the migrations component is not registered).

const listed = Object.entries(SPEAKER_GENDER_VERDICTS);

describe('applySpeakerGenderVerdicts', () => {
  it('the generated module lists definitive verdicts only', () => {
    expect(listed.length).toBeGreaterThan(0);
    for (const [, verdict] of listed) {
      expect(['male', 'female']).toContain(verdict);
    }
  });

  it('stamps the listed sentences of a dataset, leaves the rest and a later check alone, and is idempotent', async () => {
    const t = convexTest(schema, modules);
    const [[firstId, firstVerdict], [secondId]] = listed;
    const seeded = await t.run(async (ctx) => {
      const datasetId = await ctx.db.insert('datasets', {
        slug: 'ogte-curated',
        version: '1.0.0',
        publishedAt: Date.now(),
        isActive: true,
      });
      const collectionId = await ctx.db.insert('collections', {
        name: 'L01',
        textCount: 0,
      });
      const base = {
        datasetId,
        language: 'en',
        userCreated: false,
        collectionId,
      };
      const otherVoice = firstVerdict === 'male' ? 'female' : 'male';
      // Production's shape: the old sweep's flip in both fields, no stamp.
      const inScan = await ctx.db.insert('texts', {
        ...base,
        externalId: firstId,
        text: 'I am a man.',
        collectionRank: 1,
        speakerGender: otherVoice,
        audioSpeakerGender: otherVoice,
      });
      const notInScan = await ctx.db.insert('texts', {
        ...base,
        externalId: 'not-in-the-scan',
        text: 'How is your house?',
        collectionRank: 2,
        speakerGender: 'male',
        audioSpeakerGender: 'male',
      });
      // A learner's check judged this one since: its stamp wins.
      const checked = await ctx.db.insert('texts', {
        ...base,
        externalId: secondId,
        text: 'We are brothers.',
        collectionRank: 3,
        speakerGender: 'neutral',
        audioSpeakerGender: 'female',
        metadataSource: SPEAKER_GENDER_CHECK_SOURCE,
      });
      return { datasetId, inScan, notInScan, checked };
    });
    const run = () =>
      t.run(async (ctx) =>
        applySpeakerGenderVerdictsToDataset(
          ctx,
          (await ctx.db.get(seeded.datasetId))!,
        ),
      );
    const get = (id: Id<'texts'>) => t.run((ctx) => ctx.db.get(id));

    expect(await run()).toEqual({ patched: 1 });
    expect(await get(seeded.inScan)).toMatchObject({
      speakerGender: firstVerdict,
      audioSpeakerGender: firstVerdict,
      metadataSource: SPEAKER_GENDER_SCAN_SOURCE,
    });
    expect(await get(seeded.notInScan)).toMatchObject({
      speakerGender: 'male',
      audioSpeakerGender: 'male',
    });
    expect((await get(seeded.notInScan))?.metadataSource).toBeUndefined();
    expect(await get(seeded.checked)).toMatchObject({
      speakerGender: 'neutral',
      audioSpeakerGender: 'female',
      metadataSource: SPEAKER_GENDER_CHECK_SOURCE,
    });

    // A second run finds nothing to do.
    expect(await run()).toEqual({ patched: 0 });
  });

  it('a dataset without the listed sentences is a no-op', async () => {
    const t = convexTest(schema, modules);
    const datasetId = await t.run((ctx) =>
      ctx.db.insert('datasets', {
        slug: 'other',
        version: '0.1.0',
        publishedAt: Date.now(),
        isActive: false,
      }),
    );
    expect(
      await t.run(async (ctx) =>
        applySpeakerGenderVerdictsToDataset(
          ctx,
          (await ctx.db.get(datasetId))!,
        ),
      ),
    ).toEqual({ patched: 0 });
  });
});
