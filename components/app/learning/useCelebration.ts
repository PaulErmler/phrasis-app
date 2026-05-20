import { useCallback, useState } from 'react';

/**
 * Two-flag celebration state shared between the audio gate and the
 * `<ProgressDisplay>` shell.
 *
 *  - `active`  flips optimistically *before* the review mutation awaits, so
 *              the audio hook treats `disableAutoPlay=true` and the next
 *              card never gets a chance to start playing. The shell holds
 *              an empty placeholder during this window.
 *  - `ready`   flips *after* the mutation resolves and the server has
 *              confirmed the milestone via `triggerCelebration`. Audio +
 *              counter animations gate on this so they always start against
 *              fresh post-mutation data.
 *
 * Extracted out of `useLearningMode` so the trigger semantics live in one
 * place; the parent still owns the *decision* of when to flip these (which
 * depends on the predicted milestone math + the mutation result).
 */
export interface CelebrationApi {
  active: boolean;
  ready: boolean;
  /** Called by `handleReview` to flip optimistically before the mutation. */
  setActive: (next: boolean) => void;
  /** Called by `handleReview` after the mutation resolves. */
  setReady: (next: boolean) => void;
  /** Dismiss the celebration shell. Fires `onDismiss` once flags are cleared
   *  so the parent can rotate the session id / clear per-session counters. */
  dismiss: () => void;
}

export function useCelebration(onDismiss?: () => void): CelebrationApi {
  const [active, setActive] = useState(false);
  const [ready, setReady] = useState(false);

  const dismiss = useCallback(() => {
    setActive(false);
    setReady(false);
    onDismiss?.();
  }, [onDismiss]);

  return { active, ready, setActive, setReady, dismiss };
}
