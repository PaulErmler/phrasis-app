import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from '@/components/ui/button';

describe('Button', () => {
  it('renders with default variant', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: 'Click me' });
    expect(btn).toBeInTheDocument();
    expect(btn.getAttribute('data-variant')).toBe('default');
  });

  it('applies variant and size attributes', () => {
    render(
      <Button variant="destructive" size="lg">
        Danger
      </Button>,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('data-variant')).toBe('destructive');
    expect(btn.getAttribute('data-size')).toBe('lg');
  });

  it('handles clicks', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Go</Button>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });

  it('does not fire click when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Off
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders asChild slot', () => {
    render(
      <Button asChild>
        <a href="/go">link</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'link' });
    expect(link).toHaveAttribute('href', '/go');
  });
});
