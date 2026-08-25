import { v } from 'convex/values';
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from '../_generated/server';
import { components, internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { authComponent } from '../auth';
import { deleteUserProfile } from '../db/userProfiles';
import { deleteAudioRow, deleteStorageBlobIfUnreferenced } from '../lib/audio';
import { clearAggregatesForDeck, deleteCard } from '../db/stats/cardAggregates';
import { rateLimiter } from '../rateLimiter';
import { autumnFetch, autumnFetchRaw } from '../usage/autumnClient';
import { normalizePlans } from '../../lib/autumn/customer-shape';

/**
 * Full account deletion (GDPR erasure), run by an operator against a user
 * who asked for it in-app:
 *
 *   npx convex run admin/deleteUser:run '{"userId":"...","email":"a@b.c","dryRun":true}'
 *   npx convex run admin/deleteUser:run '{"userId":"...","email":"a@b.c"}'
 *
 * Deliberately NOT self-serve. Better Auth's own `user.deleteUser` stays
 * disabled (see convex/auth.ts) because deleting the auth user alone orphans
 * every app table and the Autumn/Stripe subscription; this is the path that
 * takes all of it.
 *
 * Three guards stand between a typo and deleting a stranger:
 *   1. `userId` and `email` must BOTH resolve to the same Better Auth user
 *      (the same double-match rule the `admins` table uses).
 *   2. An `accountDeletions` row with status 'requested' must exist, i.e. the
 *      user actually asked. `overrideNoRequest: true` is the recorded escape
 *      hatch for requests that arrived out of band.
 *   3. `dryRun: true` reports the inventory and deletes nothing.
 *
 * Shape: an action drives a loop of bounded mutations. One transaction cannot
 * do this (unbounded cards/stats rows, plus 62 aggregate subtransactions per
 * deck), and the Autumn call needs `fetch`. Every batch re-derives what is
 * left from the database rather than carrying a cursor, so an interrupted run
 * is resumed simply by running the command again.
 */

// Bounded per batch so no single transaction approaches the mutation limits.
// Cards are the expensive ones: `deleteCard` touches up to 6 aggregate
// components per card on top of the row itself.
const CARD_BATCH = 40;
const TEXT_BATCH = 25;
const ROW_BATCH = 200;
// Backstop on the action's mutation loop. At the batch sizes above this is
// ~1M rows, far past any real account; hitting it means something is not
// draining and the run should stop rather than spin.
const MAX_BATCHES = 5000;

/**
 * Purge phases, in execution order. The `accountDeletions` row stores the
 * current one, so a resumed run picks up where it stopped.
 *
 * Order is load-bearing:
 *  - `cards` before `texts`, so the orphan check on a user-created text sees
 *    no remaining card referencing it.
 *  - `aggregates` after `cards` (per-card entries are already gone via
 *    `deleteCard`; this drops the leftover namespaces) and before `courses`,
 *    which deletes the decks those namespaces are keyed on.
 *  - `collections` before `courses`, because `courseSettings` holds the ONLY
 *    reference to a user's custom/chat collections. Deleting it first leaks
 *    them permanently (they have no by-user index).
 *  - `auth` last: the Better Auth user id is the key every earlier phase
 *    queries by.
 */
const PHASES = [
  'cards',
  'aggregates',
  'texts',
  'approvals',
  'collections',
  'userTables',
  'courses',
  'auth',
  'done',
] as const;
type Phase = (typeof PHASES)[number];

function nextPhase(phase: Phase): Phase {
  return PHASES[PHASES.indexOf(phase) + 1] ?? 'done';
}

function isPhase(value: string | undefined): value is Phase {
  return PHASES.includes(value as Phase);
}

/**
 * Tables holding one or more rows per user, all reachable by an equality
 * lookup on a userId-prefixed index. Drained generically in the `userTables`
 * phase. Everything user-scoped that is NOT in this list is handled by a
 * dedicated phase above (cards, texts, approvals, collections, courses) —
 * `convex/tests/admin/deleteUser.test.ts` asserts the union covers the schema,
 * so a new user-scoped table fails the test instead of silently surviving
 * deletion.
 */
export const USER_TABLES = [
  'userSettings',
  'onboardingProgress',
  'courseStats',
  'dailyStats',
  'reviewLogs',
  'collectionProgress',
  'collectionTextMarks',
  'dailyLanguageStats',
  'userWords',
  'userWordTexts',
  'languageStats',
  'weeklyStats',
  'monthlyStats',
  'yearlyStats',
  'reviewDepthAccuracy',
  'usageQuotas',
  'billingTestOverrides',
  'admins',
  'userProfiles',
  // Card-edit audit log. The rows carry the user's own typed sentences, so
  // they purge with the account rather than surviving as a QC record: the
  // quality signal is not worth retaining text from a deleted account.
  // `cardEditRetranslations` denormalizes `userId` from its parent precisely
  // so it can be drained here by one indexed read.
  'cardEdits',
  'cardEditRetranslations',
] as const;
type UserTable = (typeof USER_TABLES)[number];

/**
 * Every table in USER_TABLES indexes userId first, but under different index
 * names, so each gets its own one-line typed page reader. Returning ids keeps
 * the union simple; the caller only deletes.
 */
type UserTableDrain = (
  ctx: MutationCtx,
  userId: string,
) => Promise<Array<Id<UserTable>>>;

const ids = (docs: Array<{ _id: Id<UserTable> }>): Array<Id<UserTable>> =>
  docs.map((d) => d._id);

const USER_TABLE_DRAINS: Record<UserTable, UserTableDrain> = {
  userSettings: async (ctx, u) =>
    ids(await ctx.db.query('userSettings').withIndex('by_userId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  onboardingProgress: async (ctx, u) =>
    ids(await ctx.db.query('onboardingProgress').withIndex('by_userId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  courseStats: async (ctx, u) =>
    ids(await ctx.db.query('courseStats').withIndex('by_userId_and_courseId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  dailyStats: async (ctx, u) =>
    ids(await ctx.db.query('dailyStats').withIndex('by_userId_and_courseId_and_date', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  reviewLogs: async (ctx, u) =>
    ids(await ctx.db.query('reviewLogs').withIndex('by_userId_and_courseId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  collectionProgress: async (ctx, u) =>
    ids(await ctx.db.query('collectionProgress').withIndex('by_userId_and_courseId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  collectionTextMarks: async (ctx, u) =>
    ids(await ctx.db.query('collectionTextMarks').withIndex('by_userId_and_courseId_and_textId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  dailyLanguageStats: async (ctx, u) =>
    ids(await ctx.db.query('dailyLanguageStats').withIndex('by_userId_and_courseId_and_date', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  userWords: async (ctx, u) =>
    ids(await ctx.db.query('userWords').withIndex('by_userId_and_courseId_and_language_and_word', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  userWordTexts: async (ctx, u) =>
    ids(await ctx.db.query('userWordTexts').withIndex('by_userId_courseId_language_word', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  languageStats: async (ctx, u) =>
    ids(await ctx.db.query('languageStats').withIndex('by_userId_and_courseId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  weeklyStats: async (ctx, u) =>
    ids(await ctx.db.query('weeklyStats').withIndex('by_userId_and_courseId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  monthlyStats: async (ctx, u) =>
    ids(await ctx.db.query('monthlyStats').withIndex('by_userId_and_courseId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  yearlyStats: async (ctx, u) =>
    ids(await ctx.db.query('yearlyStats').withIndex('by_userId_and_courseId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  reviewDepthAccuracy: async (ctx, u) =>
    ids(await ctx.db.query('reviewDepthAccuracy').withIndex('by_userId_and_courseId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  usageQuotas: async (ctx, u) =>
    ids(await ctx.db.query('usageQuotas').withIndex('by_userId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  billingTestOverrides: async (ctx, u) =>
    ids(await ctx.db.query('billingTestOverrides').withIndex('by_userId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  admins: async (ctx, u) =>
    ids(await ctx.db.query('admins').withIndex('by_userId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  userProfiles: async (ctx, u) =>
    ids(await ctx.db.query('userProfiles').withIndex('by_userId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  cardEdits: async (ctx, u) =>
    ids(await ctx.db.query('cardEdits').withIndex('by_userId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
  cardEditRetranslations: async (ctx, u) =>
    ids(await ctx.db.query('cardEditRetranslations').withIndex('by_userId', (q) => q.eq('userId', u)).take(ROW_BATCH)),
};

export interface PurgeInventory {
  courses: number;
  decks: number;
  cards: number;
  texts: number;
  chatApprovals: number;
  customCollections: number;
  hasQuotaRow: boolean;
  isAdmin: boolean;
}

// Explicit result shapes for the same-file ctx.run* calls in `run`; without
// them TypeScript trips over the internal.admin.deleteUser type circularity.
interface PreflightResult {
  authOk: boolean;
  emailMatches: boolean;
  authEmail: string | null;
  requestStatus: 'requested' | 'running' | 'completed' | null;
  inventory: PurgeInventory;
}

interface PurgeBatchResult {
  phase: string;
  deleted: number;
  totalDeleted: number;
  done: boolean;
}

export type RunResult =
  | {
    dryRun: true;
    wouldRun: boolean;
    authUserFound: boolean;
    emailMatches: boolean;
    authEmail: string | null;
    deletionRequest: 'requested' | 'running' | 'completed' | null;
    inventory: PurgeInventory;
  }
  | {
    dryRun: false;
    deleted: true;
    docsDeleted: number;
    batches: number;
    autumnCustomerExisted: boolean;
    cancelledProductIds: string[];
  };

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

/**
 * Validate the target and describe what would be deleted. Also the dry-run
 * body. `authOk` is false once the Better Auth user is already gone, which is
 * the normal state when resuming a run that got as far as the `auth` phase.
 */
export const preflight = internalQuery({
  args: { userId: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const authUser = await authComponent.getAnyUserById(ctx, args.userId);
    const authEmail = authUser?.email?.toLowerCase();

    const request = await ctx.db
      .query('accountDeletions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    const courses = await ctx.db
      .query('courses')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(100);

    let deckCount = 0;
    let cardCount = 0;
    let customCollections = 0;
    for (const course of courses) {
      const decks = await ctx.db
        .query('decks')
        .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
        .take(20);
      deckCount += decks.length;
      for (const deck of decks) cardCount += deck.cardCount;
      const settings = await ctx.db
        .query('courseSettings')
        .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
        .first();
      if (settings) {
        customCollections += collectionIdsFromSettings(settings).length;
      }
    }

    const texts = await ctx.db
      .query('texts')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(1000);
    const approvals = await ctx.db
      .query('cardApprovals')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .take(1000);
    const quota = await ctx.db
      .query('usageQuotas')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    const admin = await ctx.db
      .query('admins')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    return {
      authOk: authUser !== null,
      emailMatches: authEmail === email,
      authEmail: authEmail ?? null,
      requestStatus: request?.status ?? null,
      inventory: {
        courses: courses.length,
        decks: deckCount,
        // Denormalized deck counters; exact enough for an eyeball check.
        cards: cardCount,
        texts: texts.length,
        chatApprovals: approvals.length,
        customCollections,
        hasQuotaRow: quota !== null,
        isAdmin: admin !== null,
      } satisfies PurgeInventory,
    };
  },
});

/** The user's own custom/chat collections, as recorded on courseSettings. */
function collectionIdsFromSettings(
  settings: Doc<'courseSettings'>,
): Id<'collections'>[] {
  const ids = [
    settings.chatCollectionId,
    settings.customCollectionId,
    ...(settings.activeCustomCollectionIds ?? []),
  ].filter((id): id is Id<'collections'> => id !== undefined);
  return [...new Set(ids)];
}

// ---------------------------------------------------------------------------
// Phase 0: claim the run
// ---------------------------------------------------------------------------

/**
 * Enforce the guards, mark the run started, and kill the user's sessions.
 *
 * Sessions go first so an open client can't keep writing rows (or re-run
 * `syncQuotas`, which would recreate the Autumn customer) behind the purge.
 * Returns the email to use for the rest of the run: the auth user's own,
 * which is what the Better Auth `verification` rows are keyed by.
 */
export const beginPurge = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    overrideNoRequest: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const email = args.email.trim().toLowerCase();
    const authUser = await authComponent.getAnyUserById(ctx, args.userId);

    const existing = await ctx.db
      .query('accountDeletions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();

    // Checked before the auth-user guard: after a completed purge the auth
    // user is gone, and "already deleted" is the answer, not "no such user".
    if (existing?.status === 'completed') {
      throw new Error(
        `Account "${existing.email}" was already deleted (completed ${new Date(existing.completedAt ?? 0).toISOString()}).`,
      );
    }

    if (!authUser) {
      // Resuming a run that already deleted the auth user is fine; starting
      // one against an id that never existed is not.
      if (!existing || existing.status !== 'running') {
        throw new Error(
          `No Better Auth user "${args.userId}" and no purge in progress for it. Refusing to run.`,
        );
      }
      if (existing.email !== email) {
        throw new Error(
          `Email mismatch on the in-progress purge (row has "${existing.email}"). Refusing to run.`,
        );
      }
    } else if (authUser.email.toLowerCase() !== email) {
      throw new Error(
        `Email mismatch: user "${args.userId}" is "${authUser.email}", not "${email}". Refusing to run.`,
      );
    }

    if (!existing && !args.overrideNoRequest) {
      throw new Error(
        `No account-deletion request on file for "${email}". The user must request deletion in-app first; pass overrideNoRequest: true (recorded on the audit row) for requests that arrived out of band.`,
      );
    }
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        status: 'running',
        startedAt: existing.startedAt ?? now,
        lastProgressAt: now,
        phase: existing.phase ?? PHASES[0],
        ...(args.overrideNoRequest ? { overrideNoRequest: true } : {}),
      });
    } else {
      await ctx.db.insert('accountDeletions', {
        userId: args.userId,
        email,
        status: 'running',
        overrideNoRequest: true,
        startedAt: now,
        lastProgressAt: now,
        phase: PHASES[0],
        docsDeleted: 0,
      });
    }

    // Revoke every session. Bounded loop: a user has a handful, and the
    // component paginates.
    let cursor: string | null = null;
    for (let i = 0; i < 20; i++) {
      const res: { isDone: boolean; continueCursor: string } =
        await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
          input: {
            model: 'session',
            where: [{ field: 'userId', value: args.userId }],
          },
          paginationOpts: { cursor, numItems: 100 },
        });
      if (res.isDone) break;
      cursor = res.continueCursor;
    }

    return { email, authEmail: authUser?.email.toLowerCase() ?? email };
  },
});

// ---------------------------------------------------------------------------
// The batch worker
// ---------------------------------------------------------------------------

/**
 * Do one bounded slice of the purge and report whether more remains. Every
 * phase re-queries the database for what is still there, so calling this
 * repeatedly (or re-running the whole command after a crash) converges
 * without any cursor bookkeeping.
 */
export const purgeBatch = internalMutation({
  args: { userId: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('accountDeletions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    if (!row) throw new Error(`No accountDeletions row for "${args.userId}"`);

    const phase: Phase = isPhase(row.phase) ? row.phase : PHASES[0];
    const result = await runPhase(ctx, phase, args.userId, args.email, row);

    const deleted = (row.docsDeleted ?? 0) + result.deleted;
    await ctx.db.patch(row._id, {
      phase: result.phaseDone ? nextPhase(phase) : phase,
      phaseCursor: result.phaseDone ? undefined : result.phaseCursor,
      docsDeleted: deleted,
      lastProgressAt: Date.now(),
    });

    const finished = result.phaseDone && nextPhase(phase) === 'done';
    return {
      phase,
      deleted: result.deleted,
      totalDeleted: deleted,
      done: finished,
    };
  },
});

interface PhaseResult {
  deleted: number;
  phaseDone: boolean;
  phaseCursor?: string;
}

async function runPhase(
  ctx: MutationCtx,
  phase: Phase,
  userId: string,
  email: string,
  row: Doc<'accountDeletions'>,
): Promise<PhaseResult> {
  switch (phase) {
    case 'cards':
      return purgeCards(ctx, userId);
    case 'aggregates':
      return purgeAggregates(ctx, userId, row.phaseCursor);
    case 'texts':
      return purgeTexts(ctx, userId);
    case 'approvals':
      return purgeApprovals(ctx, userId);
    case 'collections':
      return purgeCollections(ctx, userId);
    case 'userTables':
      return purgeUserTables(ctx, userId, email);
    case 'courses':
      return purgeCourses(ctx, userId);
    case 'auth':
      return purgeAuth(ctx, userId, email);
    case 'done':
      return { deleted: 0, phaseDone: true };
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unhandled purge phase: ${String(_exhaustive)}`);
    }
  }
}

async function userDecks(
  ctx: MutationCtx,
  userId: string,
): Promise<Id<'decks'>[]> {
  const courses = await ctx.db
    .query('courses')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(100);
  const deckIds: Id<'decks'>[] = [];
  for (const course of courses) {
    const decks = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
      .take(20);
    for (const deck of decks) deckIds.push(deck._id);
  }
  return deckIds;
}

/** Cards go through `deleteCard` so all six aggregates stay consistent. */
async function purgeCards(
  ctx: MutationCtx,
  userId: string,
): Promise<PhaseResult> {
  for (const deckId of await userDecks(ctx, userId)) {
    const cards = await ctx.db
      .query('cards')
      .withIndex('by_deckId', (q) => q.eq('deckId', deckId))
      .take(CARD_BATCH);
    if (cards.length === 0) continue;
    for (const card of cards) {
      await deleteCard(ctx, card._id);
    }
    return { deleted: cards.length, phaseDone: false };
  }
  return { deleted: 0, phaseDone: true };
}

/**
 * Drop the per-deck aggregate NAMESPACES left behind once the cards are gone.
 * One deck and one track per call: both tracks together is 62 component
 * subtransactions, which is what the recalc migration splits for too.
 * The cursor is `${deckId}:${track}`.
 */
async function purgeAggregates(
  ctx: MutationCtx,
  userId: string,
  cursor: string | undefined,
): Promise<PhaseResult> {
  const deckIds = await userDecks(ctx, userId);
  if (deckIds.length === 0) return { deleted: 0, phaseDone: true };

  const [cursorDeck, cursorTrack] = (cursor ?? '').split(':');
  const startIdx = cursorDeck
    ? deckIds.findIndex((id) => id === cursorDeck)
    : 0;
  const idx = startIdx === -1 ? 0 : startIdx;
  const track = cursorTrack === 'writing' ? 'writing' : 'shared';

  await clearAggregatesForDeck(ctx, deckIds[idx], track);

  if (track === 'shared') {
    return {
      deleted: 0,
      phaseDone: false,
      phaseCursor: `${deckIds[idx]}:writing`,
    };
  }
  const nextIdx = idx + 1;
  if (nextIdx >= deckIds.length) return { deleted: 0, phaseDone: true };
  return {
    deleted: 0,
    phaseDone: false,
    phaseCursor: `${deckIds[nextIdx]}:shared`,
  };
}

/**
 * User-created texts and everything hanging off them: translations, audio
 * pointers (reference-counted, so a blob shared with premade content
 * survives), failed-validation audio and ITS blob, and in-flight pipeline
 * claims.
 */
async function purgeTexts(
  ctx: MutationCtx,
  userId: string,
): Promise<PhaseResult> {
  const texts = await ctx.db
    .query('texts')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(TEXT_BATCH);
  if (texts.length === 0) return { deleted: 0, phaseDone: true };

  let deleted = 0;
  for (const text of texts) {
    // Defensive: the cards phase runs first, so nothing should reference
    // these any more. A premade text can never land here (userId is only
    // stamped on user-created rows), but a surviving reference would mean
    // deleting content another card still renders.
    const referencing = await ctx.db
      .query('cards')
      .withIndex('by_textId', (q) => q.eq('textId', text._id))
      .first();
    if (referencing) {
      console.warn('[deleteUser] text still referenced by a card, skipping', {
        textId: text._id,
        cardId: referencing._id,
      });
      // Unstamp the owner so the scan advances instead of looping forever on
      // this row; the text itself stays and stops being user-attributed.
      await ctx.db.patch(text._id, { userId: undefined });
      continue;
    }

    for (const tr of await ctx.db
      .query('translations')
      .withIndex('by_textId', (q) => q.eq('textId', text._id))
      .collect()) {
      await ctx.db.delete(tr._id);
      deleted++;
    }
    for (const audio of await ctx.db
      .query('audioRecordings')
      .withIndex('by_textId', (q) => q.eq('textId', text._id))
      .collect()) {
      await deleteAudioRow(ctx, audio);
      deleted++;
    }
    // ttsMismatches owns its blob outright and has no shared-cache helper.
    for (const mismatch of await ctx.db
      .query('ttsMismatches')
      .withIndex('by_textId', (q) => q.eq('textId', text._id))
      .collect()) {
      const storageId = mismatch.storageId;
      await ctx.db.delete(mismatch._id);
      await deleteStorageBlobIfUnreferenced(ctx, storageId);
      deleted++;
    }
    for (const claim of await ctx.db
      .query('ttsGenerationClaims')
      .withIndex('by_text_and_language', (q) => q.eq('textId', text._id))
      .collect()) {
      await ctx.db.delete(claim._id);
      deleted++;
    }
    for (const claim of await ctx.db
      .query('llmTranslationClaims')
      .withIndex('by_text_and_language', (q) => q.eq('textId', text._id))
      .collect()) {
      await ctx.db.delete(claim._id);
      deleted++;
    }
    await ctx.db.delete(text._id);
    deleted++;
  }
  return { deleted, phaseDone: false };
}

async function purgeApprovals(
  ctx: MutationCtx,
  userId: string,
): Promise<PhaseResult> {
  const rows = await ctx.db
    .query('cardApprovals')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(ROW_BATCH);
  for (const row of rows) await ctx.db.delete(row._id);
  return { deleted: rows.length, phaseDone: rows.length < ROW_BATCH };
}

/**
 * The user's own chat/custom collections, reachable only through
 * `courseSettings`. Premade collections are shared content and are skipped
 * even if one is listed in `activeCustomCollectionIds`.
 */
async function purgeCollections(
  ctx: MutationCtx,
  userId: string,
): Promise<PhaseResult> {
  const courses = await ctx.db
    .query('courses')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(100);

  let deleted = 0;
  for (const course of courses) {
    const settings = await ctx.db
      .query('courseSettings')
      .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
      .first();
    if (!settings) continue;
    for (const collectionId of collectionIdsFromSettings(settings)) {
      const collection = await ctx.db.get(collectionId);
      if (!collection) continue;
      if (collection.origin !== 'custom' && collection.origin !== 'chat') {
        continue;
      }
      if (collection.datasetId) continue;
      // A text still in it means the texts phase left something behind
      // (a card elsewhere referencing it). Keep the collection so the text
      // stays reachable.
      const remainingText = await ctx.db
        .query('texts')
        .withIndex('by_collection_and_rank', (q) =>
          q.eq('collectionId', collectionId),
        )
        .first();
      if (remainingText) continue;
      await ctx.db.delete(collectionId);
      deleted++;
    }
  }
  return { deleted, phaseDone: true };
}

/** Drain the flat per-user tables, one table per call. */
async function purgeUserTables(
  ctx: MutationCtx,
  userId: string,
  email: string,
): Promise<PhaseResult> {
  for (const table of USER_TABLES) {
    const rowIds = await USER_TABLE_DRAINS[table](ctx, userId);
    if (rowIds.length === 0) continue;
    for (const rowId of rowIds) await ctx.db.delete(rowId);
    return { deleted: rowIds.length, phaseDone: false };
  }

  // Email-keyed leftovers. E2E-only capture table; harmless in prod where it
  // is always empty.
  const testEmails = await ctx.db
    .query('testAuthEmails')
    .withIndex('by_email', (q) => q.eq('email', email))
    .take(ROW_BATCH);
  for (const row of testEmails) await ctx.db.delete(row._id);
  if (testEmails.length === ROW_BATCH) {
    return { deleted: testEmails.length, phaseDone: false };
  }

  // Belt and braces: the auth trigger also removes the profile mirror, but
  // the purge must not depend on a trigger it doesn't control.
  await deleteUserProfile(ctx, userId);
  await rateLimiter.reset(ctx, 'accountDeletionRequest', { key: userId });
  return { deleted: testEmails.length, phaseDone: true };
}

async function purgeCourses(
  ctx: MutationCtx,
  userId: string,
): Promise<PhaseResult> {
  const courses = await ctx.db
    .query('courses')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .take(100);
  if (courses.length === 0) return { deleted: 0, phaseDone: true };

  let deleted = 0;
  for (const course of courses) {
    const settings = await ctx.db
      .query('courseSettings')
      .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
      .first();
    if (settings) {
      await ctx.db.delete(settings._id);
      deleted++;
    }
    const decks = await ctx.db
      .query('decks')
      .withIndex('by_courseId', (q) => q.eq('courseId', course._id))
      .take(20);
    for (const deck of decks) {
      await ctx.db.delete(deck._id);
      deleted++;
    }
    await ctx.db.delete(course._id);
    deleted++;
  }
  return { deleted, phaseDone: true };
}

/**
 * The Better Auth component's own rows. `verification` is keyed by email
 * rather than user id (pending OTPs and reset links), so a fresh signup on
 * the same address starts clean.
 */
async function purgeAuth(
  ctx: MutationCtx,
  userId: string,
  email: string,
): Promise<PhaseResult> {
  let deleted = 0;
  for (const model of ['account', 'session', 'twoFactor'] as const) {
    const res: { count: number; isDone: boolean } = await ctx.runMutation(
      components.betterAuth.adapter.deleteMany,
      {
        input: { model, where: [{ field: 'userId', value: userId }] },
        paginationOpts: { cursor: null, numItems: 200 },
      },
    );
    deleted += res.count;
    if (!res.isDone) return { deleted, phaseDone: false };
  }

  const verifications: { count: number; isDone: boolean } =
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'verification',
        where: [{ field: 'identifier', value: email }],
      },
      paginationOpts: { cursor: null, numItems: 200 },
    });
  deleted += verifications.count;
  if (!verifications.isDone) return { deleted, phaseDone: false };

  await ctx.runMutation(components.betterAuth.adapter.deleteOne, {
    input: { model: 'user', where: [{ field: '_id', value: userId }] },
  });
  return { deleted: deleted + 1, phaseDone: true };
}

export const markCompleted = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('accountDeletions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    if (!row) return null;
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: 'completed',
      completedAt: now,
      lastProgressAt: now,
      phase: 'done',
      phaseCursor: undefined,
    });
    return null;
  },
});

/** Status of a purge, for the e2e spec and for checking on a resumed run. */
export const purgeStatus = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('accountDeletions')
      .withIndex('by_userId', (q) => q.eq('userId', args.userId))
      .first();
    if (!row) return null;
    return {
      status: row.status,
      phase: row.phase ?? null,
      docsDeleted: row.docsDeleted ?? 0,
      requestedAt: row.requestedAt ?? null,
      completedAt: row.completedAt ?? null,
      overrideNoRequest: row.overrideNoRequest ?? false,
    };
  },
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

/**
 * Cancel any paid subscription and delete the Autumn customer, taking the
 * Stripe customer with it (`delete_in_stripe`). Paid invoices stay in Stripe:
 * they are financial records, which is both required for accounting and
 * permitted under GDPR.
 *
 * Everything goes through Autumn, never Stripe directly. Autumn does not
 * ingest `customer.subscription.deleted` for Managed Payments subscriptions,
 * so a Stripe-side cancel leaves Autumn reporting the plan as live (verified
 * twice, see convex/usage/testing.ts).
 *
 * A 404 is success: users who never opened a billing surface have no Autumn
 * customer at all.
 */
async function deleteBillingCustomer(customerId: string): Promise<{
  customerExisted: boolean;
  cancelledProductIds: string[];
}> {
  const customer = await autumnFetch<{ products?: unknown }>(
    'GET',
    `/customers/${encodeURIComponent(customerId)}`,
    undefined,
    '1.2',
    { nullOn404: true },
  );
  if (!customer) return { customerExisted: false, cancelledProductIds: [] };

  const cancelledProductIds: string[] = [];
  for (const plan of normalizePlans(customer)) {
    if (plan.isDefault || plan.isExpired) continue;
    await autumnFetch(
      'POST',
      '/cancel',
      {
        customer_id: customerId,
        product_id: plan.planId,
        cancel_immediately: true,
      },
      '1.2',
    );
    cancelledProductIds.push(plan.planId);
  }

  const del = await autumnFetchRaw(
    'DELETE',
    `/customers/${encodeURIComponent(customerId)}?delete_in_stripe=true`,
    undefined,
    '1.2',
  );
  if (!del.ok && del.status !== 404) {
    throw new Error(
      `Autumn customer delete failed (${del.status}): ${del.text}`,
    );
  }
  return { customerExisted: true, cancelledProductIds };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export const run = internalAction({
  args: {
    userId: v.string(),
    email: v.string(),
    dryRun: v.optional(v.boolean()),
    overrideNoRequest: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<RunResult> => {
    const email = args.email.trim().toLowerCase();
    const check: PreflightResult = await ctx.runQuery(
      internal.admin.deleteUser.preflight,
      { userId: args.userId, email },
    );

    if (args.dryRun) {
      return {
        dryRun: true as const,
        wouldRun:
          check.authOk &&
          check.emailMatches &&
          (check.requestStatus === 'requested' ||
            args.overrideNoRequest === true),
        authUserFound: check.authOk,
        emailMatches: check.emailMatches,
        authEmail: check.authEmail,
        deletionRequest: check.requestStatus,
        inventory: check.inventory,
      };
    }

    const begin: { email: string; authEmail: string } = await ctx.runMutation(
      internal.admin.deleteUser.beginPurge,
      { userId: args.userId, email, overrideNoRequest: args.overrideNoRequest },
    );
    const authEmail = begin.authEmail;

    // Billing before app data: the quota row this deletes is also what the
    // client re-syncs from, and a failure here must not leave a paying
    // customer with no account.
    const billing = await deleteBillingCustomer(args.userId);

    // AI chat lives in the agent component (threads + messages). Its action
    // form runs the whole purge to completion.
    await ctx.runAction(components.agent.users.deleteAllForUserId, {
      userId: args.userId,
    });

    let batches = 0;
    let totalDeleted = 0;
    let lastPhase = '';
    for (; batches < MAX_BATCHES; batches++) {
      const res: PurgeBatchResult = await ctx.runMutation(
        internal.admin.deleteUser.purgeBatch,
        { userId: args.userId, email: authEmail },
      );
      totalDeleted = res.totalDeleted;
      if (res.phase !== lastPhase) {
        lastPhase = res.phase;
        console.log('[deleteUser] phase', {
          phase: res.phase,
          totalDeleted: res.totalDeleted,
        });
      }
      if (res.done) break;
    }
    if (batches >= MAX_BATCHES) {
      throw new Error(
        `Purge did not converge after ${MAX_BATCHES} batches (last phase: ${lastPhase}). Re-run to continue.`,
      );
    }

    await ctx.runMutation(internal.admin.deleteUser.markCompleted, {
      userId: args.userId,
    });
    console.log('[deleteUser] completed', {
      userId: args.userId,
      totalDeleted,
      batches,
      billing,
    });

    return {
      dryRun: false as const,
      deleted: true as const,
      docsDeleted: totalDeleted,
      batches,
      autumnCustomerExisted: billing.customerExisted,
      cancelledProductIds: billing.cancelledProductIds,
    };
  },
});
