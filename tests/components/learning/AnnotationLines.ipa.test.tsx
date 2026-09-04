import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { AnnotationLines } from '@/components/app/learning/AnnotationLines';
import { useLocalPlaySignals } from '@/components/app/learning/useLocalPlaySignals';

describe('AnnotationLines IPA line', () => {
  it('is plain text without a click handler', () => {
    render(<AnnotationLines ipa="ola" showIpa />);
    const line = screen.getByTestId('ipa-line');
    expect(line.tagName).toBe('P');
    expect(line).toHaveTextContent('/ola/');
  });

  it('becomes a button that plays the sentence when a handler is given', () => {
    const onIpaClick = vi.fn();
    render(<AnnotationLines ipa="ola" showIpa onIpaClick={onIpaClick} />);
    const line = screen.getByTestId('ipa-line');
    expect(line.tagName).toBe('BUTTON');
    fireEvent.click(line);
    expect(onIpaClick).toHaveBeenCalledOnce();
  });

  it('stays hidden when the IPA setting is off', () => {
    render(<AnnotationLines ipa="ola" onIpaClick={() => {}} />);
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
