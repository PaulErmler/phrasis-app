import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { AnnotationLines } from '@/components/app/learning/AnnotationLines';
import { useLocalPlaySignals } from '@/components/app/learning/useLocalPlaySignals';

describe('AnnotationLines IPA line', () => {
  it('renders the transcription between slashes', () => {
    render(<AnnotationLines ipa="ola" showIpa />);
    expect(screen.getByTestId('ipa-line')).toHaveTextContent('/ola/');
  });

  it('does NOT play the sentence when tapped', () => {
    // It used to. The lines are now the word-mapping control, and one target
    // cannot mean two things; the speaker button beside the sentence plays it.
    render(<AnnotationLines ipa="ola" showIpa />);
    expect(screen.getByTestId('ipa-line').closest('button')).toBeNull();
  });

  it('stays hidden when the IPA setting is off', () => {
    render(<AnnotationLines ipa="ola" />);
    expect(screen.queryByTestId('ipa-line')).toBeNull();
  });
});

describe('useLocalPlaySignals', () => {
  it('changes a row signal on bump and folds in the external nonce', () => {
    const { result } = renderHook(() => useLocalPlaySignals());
    expect(result.current.signalFor('es', 3)).toBe(3);
    expect(result.current.signalFor('fr')).toBe(0);

    act(() => result.current.bump('es'));
    expect(result.current.signalFor('es', 3)).toBe(4);
    expect(result.current.signalFor('fr')).toBe(0);

    // External replay (keyboard) still moves the same signal.
    expect(result.current.signalFor('es', 4)).toBe(5);
  });
});
