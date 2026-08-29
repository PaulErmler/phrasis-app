/// <reference types="vite/client" />
import { convexTest, type TestConvex } from 'convex-test';
import { describe, it, expect } from 'vitest';

import schema, { coursePatchableSettingsValidator } from '../../schema';
import { api } from '../../_generated/api';
import type { Id } from '../../_generated/dataModel';

const modules = import.meta.glob('/convex/**/*.ts');

/**
 * Exhaustive course-settings sweep: derive a sample value for EVERY patchable
 * settings key straight from the validator (so new keys are covered
 * automatically), write it through `updateCourseSettings`, and read the row
 * back through `getActiveCourseSettings`. Catches two classes of drift the
 * targeted tests can miss:
 *
 *   1. arg-validator vs clamp/insert-branch mismatches (a key that validates
 *      but throws: or silently vanishes, when written), and
 *   2. write vs read-validator mismatches (a stored value the settings query
 *      can no longer return).
 *
 * Union-typed keys are exercised with every literal member, not just one.
 */

type AnyValidator = any;

/** All sample values to try for a validator (unions fan out per literal). */
function samplesFor(validator: AnyValidator): unknown[] {
  switch (validator.kind) {
    case 'float64':
      // 2 sits inside every numeric clamp in updateCourseSettings
      // (batch size ≥1, reps 0..10, untilGood 1..10, goal 1..120).
      return [2];
    case 'string':
      return ['sweep-sample'];
    case 'boolean':
      return [true, false];
    case 'literal':
      return [validator.value];
    case 'union':
      return validator.members.flatMap((m: AnyValidator) => samplesFor(m));
    case 'array':
      return [[samplesFor(validator.element)[0]]];
    case 'record':
      // Course languages in this test are en/de; playback-speed records are
      // keyed by language code with clamped numeric values.
      return [{ de: 1 }];
    case 'object':
      return [
        Object.fromEntries(
          Object.entries(validator.fields).map(([k, f]) => [
            k,
            samplesFor(f as AnyValidator)[0],
          ]),
        ),
      ];
    default:
      // ids / unknown kinds, nothing generic to write safely.
      return [];
  }
}

async function makeActiveCourse(t: TestConvex<typeof schema>): Promise<{
  asUser: ReturnType<TestConvex<typeof schema>['withIdentity']>;
  courseId: Id<'courses'>;
}> {
  const courseId = await t.run(async (ctx) =>
    ctx.db.insert('courses', {
      userId: 'user_A',
      baseLanguages: ['en'],
      targetLanguages: ['de'],
    }),
  );
  const asUser = t.withIdentity({ subject: 'user_A' });
  await asUser.mutation(api.features.courses.setActiveCourse, { courseId });
  return { asUser, courseId };
}

const PATCHABLE_FIELDS = Object.entries(
  coursePatchableSettingsValidator.fields,
) as Array<[string, AnyValidator]>;

describe('updateCourseSettings: exhaustive settings sweep', () => {
  it('covers every patchable key with at least one sample value', () => {
    expect(PATCHABLE_FIELDS.length).toBeGreaterThan(0);
    for (const [key, validator] of PATCHABLE_FIELDS) {
      expect(
        samplesFor(validator).length,
        `no sample derivable for '${key}' (kind ${validator.kind}) — extend samplesFor`,
      ).toBeGreaterThan(0);
    }
  });

  it('every key × every sample writes without throwing and reads back validly', async () => {
    const t = convexTest(schema, modules);
    const { asUser, courseId } = await makeActiveCourse(t);

    for (const [key, validator] of PATCHABLE_FIELDS) {
      for (const sample of samplesFor(validator)) {
        // One key at a time, so a failure names the exact culprit.
        try {
          await asUser.mutation(api.features.courses.updateCourseSettings, {
            courseId,
            [key]: sample,
          });
        } catch (e) {
          throw new Error(
            `updateCourseSettings threw for { ${key}: ${JSON.stringify(sample)} }: ${String(e)}`,
            { cause: e },
          );
        }
        // The read query's return validator must still accept the row.
        // This is where a stored-but-unreturnable value surfaces.
        const settings = await asUser.query(
          api.features.courses.getActiveCourseSettings,
          {},
        );
        expect(
          settings,
          `settings unreadable after writing '${key}'`,
        ).not.toBeNull();
      }
    }
  });

  it('all keys written together still produce a readable row (fresh insert branch)', async () => {
    // A single mutation carrying every key exercises the INSERT branch's
    // field list. A key present in the validator but missing from the
    // insert object silently drops (regression class: showRomanization).
    const t = convexTest(schema, modules);
    const { asUser, courseId } = await makeActiveCourse(t);

    const everything = Object.fromEntries(
      PATCHABLE_FIELDS.map(([key, validator]) => [
        key,
        samplesFor(validator)[0],
      ]),
    );
    await asUser.mutation(api.features.courses.updateCourseSettings, {
      courseId,
      ...everything,
    });

    const settings = await asUser.query(
      api.features.courses.getActiveCourseSettings,
      {},
    );
    expect(settings).not.toBeNull();
    for (const [key] of PATCHABLE_FIELDS) {
      expect(
        (settings as Record<string, unknown>)[key],
        `'${key}' validated but was dropped on the insert path`,
      ).not.toBeUndefined();
    }
  });
});
