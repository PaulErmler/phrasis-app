import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/image', () => ({
  default: (props: any) => {
    const { alt, src, width, height } = props;
    return <img alt={alt} src={src} width={width} height={height} />;
  },
}));

import { LogoSpinner, AppLoadingSplash } from '@/components/LogoSpinner';

describe('LogoSpinner', () => {
  it('renders logo image with alt', () => {
    render(<LogoSpinner />);
    expect(screen.getByAltText('Flexling')).toBeInTheDocument();
  });

  it('AppLoadingSplash renders logo and name', () => {
    render(<AppLoadingSplash />);
    expect(screen.getByAltText('Flexling')).toBeInTheDocument();
    expect(screen.getByText('Flexling')).toBeInTheDocument();
  });
});
