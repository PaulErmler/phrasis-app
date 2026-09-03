import { useCallback, useState } from 'react';

/**
 * Per-row replay nonces for `AudioButton.playSignal`, so an in-card control
 * (the IPA line) can start a row's clip without a ref into the button.
 *
 * `signalFor` folds an optional external nonce (the keyboard replay channel
 * the first target row already receives) into the row's own count. Both are
 * monotonic, so their sum changes on either trigger and never repeats a
 * value, which is all `playSignal` needs; the button ignores the mount
 * value and reacts to changes only.
 */
export function useLocalPlaySignals(): {
  bump: (key: string) => void;
  signalFor: (key: string, external?: number) => number;
} {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const bump = useCallback((key: string) => {
    setCounts((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
  }, []);
  const signalFor = useCallback(
    (key: string, external?: number) => (external ?? 0) + (counts[key] ?? 0),
    [counts],
  );
  return { bump, signalFor };
}
