import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Re-mock next-intl to expose the .rich helper that the dialog uses for
// inline badge markup. The global setup stub only provides plain `t(key)`.
vi.mock('next-intl', () => ({
  useTranslations: () => {
    const t = (key: string, values?: Record<string, unknown>) => {
      if (values && 'level' in values) return `${key}:${values.level}`;
      return key;
    };
    t.rich = (key: string, _values: Record<string, unknown>) => key;
    return t;
  },
  useLocale: () => 'en',
}));

import { CefrConfirmDialog } from '@/app/app/onboarding/components/CefrConfirmDialog';

describe('CefrConfirmDialog', () => {
  it('does not render content when closed', () => {
    render(
      <CefrConfirmDialog
        open={false}
        ogteLevel={8}
        onOpenChange={() => {}}
        onStartHere={() => {}}
        onTakeQuickTest={() => {}}
      />,
    );
    expect(screen.queryByText(/startHere/)).toBeNull();
  });

  it('fires onStartHere when the user clicks "Start here"', async () => {
    const onStartHere = vi.fn();
    const onTakeQuickTest = vi.fn();
    render(
      <CefrConfirmDialog
        open
        ogteLevel={8}
        onOpenChange={() => {}}
        onStartHere={onStartHere}
        onTakeQuickTest={onTakeQuickTest}
      />,
    );
    await userEvent.click(screen.getByText('startHere'));
    expect(onStartHere).toHaveBeenCalledTimes(1);
    expect(onTakeQuickTest).not.toHaveBeenCalled();
  });

  it('fires onTakeQuickTest when the user picks the test path', async () => {
    const onStartHere = vi.fn();
    const onTakeQuickTest = vi.fn();
    render(
      <CefrConfirmDialog
        open
        ogteLevel={12}
        onOpenChange={() => {}}
        onStartHere={onStartHere}
        onTakeQuickTest={onTakeQuickTest}
      />,
    );
    await userEvent.click(screen.getByText('takeQuickTest'));
    expect(onTakeQuickTest).toHaveBeenCalledTimes(1);
    expect(onStartHere).not.toHaveBeenCalled();
  });

  it('interpolates the picked level into the title', () => {
    render(
      <CefrConfirmDialog
        open
        ogteLevel={15}
        onOpenChange={() => {}}
        onStartHere={() => {}}
        onTakeQuickTest={() => {}}
      />,
    );
    // The mock translator returns "title:15" when {level} is supplied.
    expect(screen.getByText('title:15')).toBeInTheDocument();
  });
});
