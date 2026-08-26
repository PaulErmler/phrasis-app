import { v } from 'convex/values';
import {
  paginationOptsValidator,
  paginationResultValidator,
  type PaginationOptions,
} from 'convex/server';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { adminQuery } from './lib';
import {
  cardEditKindValidator,
  cardEditPathValidator,
  cardEditLanguageRoleValidator,
  collectionOriginValidator,
  retranslationStatusValidator,
  type CardEditKind,
  type RetranslationStatus,
} from '../types';

/**
 * Admin read surface for the card-edit audit log (see
 * convex/features/cardEditAudit.ts for the writers).
 *
 * Two entry points, because QC has two shapes:
 *   - `listCardEdits`: the edit-centric feed — what did users change, and what
 *     did the retranslations it triggered come back with?
 *   - `listRetranslations`: the status-centric view — everything that failed,
 *     is still in flight, or was refused, across all edits.
 *
 * Both paginate over an index (never a scan) and bound their hydration.
 */

const retranslationRowValidator = v.object({
  _id: v.id('cardEditRetranslations'),
  _creationTime: v.number(),
  language: v.string(),
  role: cardEditLanguageRoleValidator,
  status: retranslationStatusValidator,
  beforeText: v.string(),
  beforeTranslationSource: v.optional(v.string()),
  afterText: v.optional(v.string()),
  afterTranslationSource: v.optional(v.string()),
  userSuggestion: v.optional(v.string()),
  flagCountAfter: v.number(),
  rule: v.optional(v.string()),
  resolvedAt: v.optional(v.number()),
});

const cardEditRowValidator = v.object({
  _id: v.id('cardEdits'),
  _creationTime: v.number(),
  userId: v.string(),
  kind: cardEditKindValidator,
  path: cardEditPathValidator,
  collectionOrigin: v.optional(collectionOriginValidator),
  textWasUserCreated: v.boolean(),
  sourceLanguage: v.string(),
  sourceText: v.string(),
  baseLanguages: v.array(v.string()),
  targetLanguages: v.array(v.string()),
  changes: v.array(
    v.object({
      language: v.string(),
      role: cardEditLanguageRoleValidator,
      isSourceLanguage: v.boolean(),
      before: v.string(),
      after: v.optional(v.string()),
      beforeTranslationSource: v.optional(v.string()),
      beforeFlagCount: v.optional(v.number()),
      soundsSame: v.optional(v.boolean()),
    }),
  ),
  retranslations: v.array(retranslationRowValidator),
});

/**
 * Cap on children hydrated per edit. An edit can only touch as many languages
 * as the course has, so this is far above any real row; it exists so a corrupt
 * row can't make the page unbounded.
 */
const MAX_RETRANSLATIONS_PER_EDIT = 20;

function projectRetranslation(row: Doc<'cardEditRetranslations'>) {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    language: row.language,
    role: row.role,
    status: row.status,
    beforeText: row.beforeText,
    beforeTranslationSource: row.beforeTranslationSource,
    afterText: row.afterText,
    afterTranslationSource: row.afterTranslationSource,
    userSuggestion: row.userSuggestion,
    flagCountAfter: row.flagCountAfter,
    rule: row.rule,
    resolvedAt: row.resolvedAt,
  };
}

async function hydrateRetranslations(ctx: QueryCtx, edit: Doc<'cardEdits'>) {
  const children = await ctx.db
    .query('cardEditRetranslations')
    .withIndex('by_cardEditId', (q) => q.eq('cardEditId', edit._id))
    .take(MAX_RETRANSLATIONS_PER_EDIT);
  return {
    _id: edit._id,
    _creationTime: edit._creationTime,
    userId: edit.userId,
    kind: edit.kind,
    path: edit.path,
    collectionOrigin: edit.collectionOrigin,
    textWasUserCreated: edit.textWasUserCreated,
    sourceLanguage: edit.sourceLanguage,
    sourceText: edit.sourceText,
    baseLanguages: edit.baseLanguages,
    targetLanguages: edit.targetLanguages,
    changes: edit.changes,
    retranslations: children.map(projectRetranslation),
  };
}

/**
 * Newest edits first, each with the retranslations it triggered.
 *
 * `kind` switches the index rather than filtering a page: `by_kind` has
 * `_creationTime` appended, so a filtered feed is still an ordered index scan
 * and never returns short pages.
 */
// Handler exported for convex-test (the adminQuery gate needs a live Better
// Auth component the test harness does not register); the gate itself stays
// structural via adminQuery below.
export async function listCardEditsHandler(
  ctx: QueryCtx,
  args: { paginationOpts: PaginationOptions; kind?: CardEditKind },
) {
  // Bound to a local so the narrowing survives into the index closure.
  const kind = args.kind;
  const query =
    kind === undefined
      ? ctx.db.query('cardEdits')
      : ctx.db.query('cardEdits').withIndex('by_kind', (q) => q.eq('kind', kind));
  const result = await query.order('desc').paginate(args.paginationOpts);
  return {
    ...result,
    page: await Promise.all(
      result.page.map((edit) => hydrateRetranslations(ctx, edit)),
    ),
  };
}

export const listCardEdits = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    kind: v.optional(cardEditKindValidator),
  },
  returns: paginationResultValidator(cardEditRowValidator),
  handler: listCardEditsHandler,
});

/**
 * Retranslations across all edits, newest first, each carrying enough of its
 * parent to be judged on its own. Filter by `status` to answer the questions
 * this log exists for: what failed, what is stuck in flight, what did we refuse
 * to spend on.
 */
/** See listCardEditsHandler for why this is exported. */
export async function listRetranslationsHandler(
  ctx: QueryCtx,
  args: { paginationOpts: PaginationOptions; status?: RetranslationStatus },
) {
  const status = args.status;
  const query =
    status === undefined
      ? ctx.db.query('cardEditRetranslations')
      : ctx.db
        .query('cardEditRetranslations')
        .withIndex('by_status', (q) => q.eq('status', status));
  const result = await query.order('desc').paginate(args.paginationOpts);
  return {
    ...result,
    page: await Promise.all(
      result.page.map(async (row) => {
        const parent = await ctx.db.get(row.cardEditId);
        return {
          ...projectRetranslation(row),
          sourceLanguage: row.sourceLanguage,
          sourceText: row.sourceText,
          kind: parent?.kind,
          // From the child row, not the parent: userId is denormalized onto
          // it precisely so the row stays attributable while a deletion
          // drain has already removed the parent batch.
          userId: row.userId,
        };
      }),
    ),
  };
}

export const listRetranslations = adminQuery({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(retranslationStatusValidator),
  },
  returns: paginationResultValidator(
    v.object({
      ...retranslationRowValidator.fields,
      sourceLanguage: v.string(),
      sourceText: v.string(),
      // Absent only if the parent was purged out from under the child, which
      // the account-deletion drain does in one pass — a transient state.
      kind: v.optional(cardEditKindValidator),
      userId: v.optional(v.string()),
    }),
  ),
  handler: listRetranslationsHandler,
});
