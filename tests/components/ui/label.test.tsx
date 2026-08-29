import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Label } from '@/components/ui/label';

describe('Label', () => {
  it('renders label text', () => {
    render(<Label htmlFor="x">My label</Label>);
    expect(screen.getByText('My label')).toBeInTheDocument();
  });

  it('associates via htmlFor', () => {
    const { container } = render(<Label htmlFor="field-1">Name</Label>);
    const lbl = container.querySelector('label');
    expect(lbl).toHaveAttribute('for', 'field-1');
  });
});
