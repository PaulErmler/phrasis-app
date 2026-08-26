import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('renders text', () => {
    render(<Badge>New</Badge>);
    expect(screen.getByText('New')).toBeInTheDocument();
  });

  it('supports outline variant', () => {
    render(<Badge variant="outline">Hey</Badge>);
    const el = screen.getByText('Hey');
    expect(el).toBeInTheDocument();
  });

  it('renders as child via asChild', () => {
    render(
      <Badge asChild>
        <a href="/x">link</a>
      </Badge>,
    );
    expect(screen.getByRole('link', { name: 'link' })).toBeInTheDocument();
  });
});
