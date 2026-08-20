'use client';

import { useCallback, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { ApprovalActionResult } from '@/hooks/use-card-approvals';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Shimmer } from '@/components/ai-elements/shimmer';

/**
 * Pieces shared by the two inline approval boxes (`CardApproval` for
 * createCard, `AlsoCorrectApproval` for markAlsoCorrect): the streaming
 * tool-state machine, the optimistic-action state machine, the per-line
 * playback wiring, and the error/skeleton chrome. Extracted so a fix to any
 * of them lands in both boxes.
 */

/**
 * The optimistic-with-rollback machine both approval boxes run their buttons
 * through: the resolved label (`optimisticState`) flips immediately, a
 * non-success result rolls it back, otherwise a quota hit or a stale card
 * ("Card not found" after a replace from another device) rendered as a green
 * "done" while the row was still pending, and a 'usage_limit' result (or a
 * known-exhausted quota up front, `available: false`) opens the paywall for
 * the quota THAT action spends.
 *
 * `S` is the box's set of optimistic labels, `F` the paywall features its
 * actions can bill; `paywallFeature` doubles as the dialog's open state.
 */
export function useOptimisticApprovalAction<
  S extends string,
  F extends string,
>() {
  const [optimisticState, setOptimisticState] = useState<S | null>(null);
  const [paywallFeature, setPaywallFeature] = useState<F | null>(null);

  const runAction = useCallback(
    async (
      approvalId: Id<'cardApprovals'> | null,
      state: S,
      action: (id: Id<'cardApprovals'>) => Promise<ApprovalActionResult>,
      opts?: { paywall?: F; available?: boolean },
    ) => {
      if (!approvalId) return;
      if (opts?.available === false && opts.paywall) {
        setPaywallFeature(opts.paywall);
        return;
      }
      setOptimisticState(state);
      const result = await action(approvalId);
      if (result !== 'success') {
        setOptimisticState(null);
        if (result === 'usage_limit' && opts?.paywall) {
          setPaywallFeature(opts.paywall);
        }
      }
    },
    [],
  );

  return { optimisticState, paywallFeature, setPaywallFeature, runAction };
}

export interface EntryAudio {
  /** language → playback URL (null = generatable but not synthesized yet). */
  urlByLanguage: Map<string, string | null>;
  onRequestAudio: (language: string) => Promise<unknown>;
}

/**
 * Per-line playback for an approval's sentences (same UX as collection
 * previews): cached asset → instant URL; otherwise the play click synthesizes
 * into the shared audioAssets store and the reactive query delivers the URL.
 * The approvalAudio queries work on any `cardApprovals` row.
 */
export function useApprovalAudio(
  approvalId: Id<'cardApprovals'> | null,
): EntryAudio | undefined {
  const approvalAudioLines = useQuery(
    api.features.chat.approvalAudio.getApprovalAudio,
    approvalId ? { approvalId } : 'skip',
  );
  const requestApprovalAudio = useMutation(
    api.features.chat.approvalAudio.requestApprovalAudio,
  );
  return approvalId
    ? {
        urlByLanguage: new Map(
          (approvalAudioLines ?? []).map((l) => [l.language, l.url]),
        ),
        onRequestAudio: (language) =>
          requestApprovalAudio({ approvalId, language }),
      }
    : undefined;
}

export interface ApprovalToolFlags {
  /** The tool call finished (with a result or an error). */
  isToolComplete: boolean;
  /** The tool call failed, or completed with anything but its success text. */
  isError: boolean;
}

/**
 * Derive the streaming state of an approval's tool part. `successOutput` is
 * the tool's exact success string, or every string it treats as success, for
 * tools with more than one non-failure outcome (markAlsoCorrect also returns a
 * distinct "nothing to save" literal). The strings themselves live in
 * lib/types/tool-parts.ts, shared with the server-side tool handlers, so the
 * two sides can never drift.
 */
export function deriveApprovalToolState(
  toolPart: { state?: string; output?: unknown },
  successOutput: string | readonly string[],
): ApprovalToolFlags {
  const successOutputs =
    typeof successOutput === 'string' ? [successOutput] : successOutput;
  const isToolComplete =
    toolPart.state === 'output-available' || toolPart.state === 'output-error';
  const isError =
    toolPart.state === 'output-error' ||
    (isToolComplete &&
      toolPart.output !== undefined &&
      !successOutputs.includes(toolPart.output as string));
  return { isToolComplete, isError };
}

/** Red failure alert shown when the tool call itself errored. */
export function ApprovalErrorAlert({ label }: { label: string }) {
  return (
    <Alert className="my-3 border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950">
      <AlertDescription className="text-red-700 dark:text-red-300">
        {label}
      </AlertDescription>
    </Alert>
  );
}

/** Pulsing placeholder while the tool call is still streaming its proposal. */
export function ApprovalStreamingSkeleton({ label }: { label: string }) {
  return (
    <Alert className="my-3 border-muted animate-pulse">
      <AlertDescription>
        <div className="space-y-2">
          <div className="h-4 w-3/4 rounded bg-muted" />
          <div className="h-5 w-5/6 rounded bg-muted" />
        </div>
        <div className="mt-3">
          <Shimmer duration={1.5}>{label}</Shimmer>
        </div>
      </AlertDescription>
    </Alert>
  );
}
