import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import type {
  CardEditKind,
  CardEditLanguageRole,
  RetranslationStatus,
} from '../types';

/**
 * Card-edit audit log — the writers for the `cardEdits` /
 * `cardEditRetranslations` tables.
 *
 * Two questions motivate the log, neither answerable from anything else the app
 * retains: are users' edits GOOD (are they fixing real curriculum errors, or
 * breaking correct sentences?), and are the retranslations those edits trigger
 * CORRECT? The second matters more — a manual edit of a curriculum card flags
 * the shared translation row and hands the user's wording to an LLM whose
 * output overwrites the row every OTHER learner studies, with no review step.
 *
 * Plain async helpers rather than registered functions: every caller is already
 * inside a mutation, so a `ctx.runMutation` hop would only buy a subtransaction
 * nobody wants (an audit write must roll back with the edit it describes).
 */

/**
 * A language's role in the course. The one place the base/target question is
 * answered, so the three call sites can't disagree. A language may sit in both
 * arrays — unusual, but the schema permits it and the edit paths dedupe rather
 * than forbid it.
 */
export function languageRole(
  course: Doc<'courses'>,
  language: string,
): CardEditLanguageRole {
  const isBase = course.baseLanguages.includes(language);
  const isTarget = course.targetLanguages.includes(language);
  if (isBase && isTarget) return 'both';
  return isBase ? 'base' : 'target';
}

/** One entry of a `cardEdits` row's `changes` array. */
export interface CardEditChange {
  language: string;
  role: CardEditLanguageRole;
  isSourceLanguage: boolean;
  before: string;
  /** Absent for flags: the user disputed the wording without proposing any. */
  after?: string;
  beforeTranslationSource?: string;
  beforeFlagCount?: number;
  /** Absent for flags: no text changed, so there is nothing to compare. */
  soundsSame?: boolean;
}

/**
 * Insert the parent row for one edit gesture.
 *
 * On the fork path this is called BEFORE the replacement rows exist (the
 * retranslation enqueue needs this row's id, and it runs earlier), so callers
 * pass the before-ids for both `cardIdAfter` and `textIdAfter` and correct them
 * with `setCardEditResult` once the fork has happened.
 */
export async function recordCardEdit(
  ctx: MutationCtx,
  args: {
    userId: string;
    course: Doc<'courses'>;
    kind: CardEditKind;
    path: 'in_place' | 'fork' | 'none';
    cardIdBefore: Id<'cards'>;
    cardIdAfter: Id<'cards'>;
    textIdBefore: Id<'texts'>;
    textIdAfter: Id<'texts'>;
    collectionOrigin?: 'premade' | 'custom' | 'chat';
    textWasUserCreated: boolean;
    sourceLanguage: string;
    sourceText: string;
    changes: CardEditChange[];
  },
): Promise<Id<'cardEdits'>> {
  return ctx.db.insert('cardEdits', {
    userId: args.userId,
    courseId: args.course._id,
    kind: args.kind,
    path: args.path,
    cardIdBefore: args.cardIdBefore,
    cardIdAfter: args.cardIdAfter,
    textIdBefore: args.textIdBefore,
    textIdAfter: args.textIdAfter,
    ...(args.collectionOrigin
      ? { collectionOrigin: args.collectionOrigin }
      : {}),
    textWasUserCreated: args.textWasUserCreated,
    sourceLanguage: args.sourceLanguage,
    sourceText: args.sourceText,
    baseLanguages: args.course.baseLanguages,
    targetLanguages: args.course.targetLanguages,
    changes: args.changes,
  });
}

/**
 * Point a fork-path audit row at the rows the edit actually produced.
 *
 * The parent row is inserted before the fork happens — the retranslation
 * enqueue needs its id, and that runs first — so it initially carries the
 * before-ids for both. Callers correct it here, and only when something
 * actually changed: on the in-place and flag paths neither id moves and this is
 * never called.
 */
export async function setCardEditResult(
  ctx: MutationCtx,
  cardEditId: Id<'cardEdits'>,
  result: { cardIdAfter: Id<'cards'>; textIdAfter: Id<'texts'> },
): Promise<void> {
  await ctx.db.patch(cardEditId, result);
}

/**
 * The identity bundle every `recordRetranslationAttempt` call carries: who
 * edited what, which translation row was targeted, and what stood there
 * before. Built in one place so the three enqueue paths in scheduling.ts
 * can't drift; callers add `status` (and `rule` where one applies) on top.
 * The text-row trio (`textId`, `sourceLanguage`, `sourceText`) is derived
 * from the doc rather than hand-copied.
 */
export function retranslationAuditFields(opts: {
  cardEditId: Id<'cardEdits'>;
  userId: string;
  language: string;
  role: CardEditLanguageRole;
  text: Doc<'texts'>;
  beforeText: string;
  beforeTranslationSource?: string;
  userSuggestion?: string;
  flagCountAfter: number;
}) {
  return {
    cardEditId: opts.cardEditId,
    userId: opts.userId,
    language: opts.language,
    role: opts.role,
    textId: opts.text._id,
    sourceLanguage: opts.text.language,
    sourceText: opts.text.text,
    beforeText: opts.beforeText,
    beforeTranslationSource: opts.beforeTranslationSource,
    userSuggestion: opts.userSuggestion,
    flagCountAfter: opts.flagCountAfter,
  };
}

/**
 * Record one retranslation this gesture triggered, at whatever status it
 * reached synchronously: 'enqueued' when the job is on its way, or a terminal
 * skip ('skipped_capped', 'skipped_claim_contested') when it never ran.
 *
 * Terminal statuses get `resolvedAt` immediately; 'enqueued' rows are resolved
 * later by `resolveRetranslation` from the pipeline.
 */
export async function recordRetranslationAttempt(
  ctx: MutationCtx,
  args: {
    cardEditId: Id<'cardEdits'>;
    userId: string;
    language: string;
    role: CardEditLanguageRole;
    textId: Id<'texts'>;
    sourceLanguage: string;
    sourceText: string;
    beforeText: string;
    beforeTranslationSource?: string;
    userSuggestion?: string;
    flagCountAfter: number;
    rule?: string;
    status: RetranslationStatus;
  },
): Promise<Id<'cardEditRetranslations'>> {
  return ctx.db.insert('cardEditRetranslations', {
    cardEditId: args.cardEditId,
    userId: args.userId,
    language: args.language,
    role: args.role,
    textId: args.textId,
    sourceLanguage: args.sourceLanguage,
    sourceText: args.sourceText,
    beforeText: args.beforeText,
    ...(args.beforeTranslationSource
      ? { beforeTranslationSource: args.beforeTranslationSource }
      : {}),
    ...(args.userSuggestion ? { userSuggestion: args.userSuggestion } : {}),
    flagCountAfter: args.flagCountAfter,
    ...(args.rule ? { rule: args.rule } : {}),
    status: args.status,
    ...(args.status === 'enqueued' ? {} : { resolvedAt: Date.now() }),
  });
}

/**
 * Resolve an in-flight retranslation. The single patch used by every resolution
 * site in the pipeline.
 *
 * Tolerates a missing row on purpose. The audit row can be gone (an account
 * purge racing a job that has been queued for minutes), and losing the audit
 * trail must never fail the translation write it describes.
 */
export async function resolveRetranslation(
  ctx: MutationCtx,
  retranslationAuditId: Id<'cardEditRetranslations'> | undefined,
  status: RetranslationStatus,
  result?: { afterText?: string; afterTranslationSource?: string },
): Promise<void> {
  if (retranslationAuditId === undefined) return;
  const row = await ctx.db.get(retranslationAuditId);
  if (!row) return;
  await ctx.db.patch(retranslationAuditId, {
    status,
    resolvedAt: Date.now(),
    ...(result?.afterText !== undefined
      ? { afterText: result.afterText }
      : {}),
    ...(result?.afterTranslationSource !== undefined
      ? { afterTranslationSource: result.afterTranslationSource }
      : {}),
  });
}

/**
 * Resolve a retranslation only if nothing has resolved it yet. For cleanup
 * sites that run AFTER the write choke point had its chance — the pool's
 * onComplete sees every job, including ones `storeTranslationAndScheduleTTS`
 * already stamped with a real outcome, and must not overwrite that verdict
 * with its own coarser one.
 */
export async function resolveRetranslationIfPending(
  ctx: MutationCtx,
  retranslationAuditId: Id<'cardEditRetranslations'> | undefined,
  status: RetranslationStatus,
): Promise<void> {
  if (retranslationAuditId === undefined) return;
  const row = await ctx.db.get(retranslationAuditId);
  if (!row || row.status !== 'enqueued') return;
  await resolveRetranslation(ctx, retranslationAuditId, status);
}
