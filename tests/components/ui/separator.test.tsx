import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Separator } from '@/components/ui/separator';

describe('Separator', () => {
  it('renders with horizontal orientation by default', () => {
    const { container } = render(<Separator />);
    const el = container.querySelector('[data-slot="separator"]');
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('data-orientation', 'horizontal');
  });

  it('renders vertical when specified', () => {
    const { container } = render(<Separator orientation="vertical" />);
    const el = container.querySelector('[data-slot="separator"]');
    expect(el).toHaveAttribute('data-orientation', 'vertical');
  });
});
