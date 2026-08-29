import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CardShell } from '@/components/app/learning/CardShell';
import { makePresentation } from './cardPresentationStub';

// Smoke coverage: CardShell mounts with the shared presentation stub, the
// header/base-language chrome renders, and the render-prop children receive
// the base/target split. Deep behavior (karaoke, blur, speed badges) is
// covered where the parents wire it.
describe('CardShell smoke', () => {
  it('renders the review badge, base row, and hands the children the base/target split', () => {
    render(
      <CardShell
        presentation={makePresentation({
          sourceText: 'Hola mundo',
          translations: [
            {
              language: 'en',
              text: 'Hello world',
              isBaseLanguage: true,
              isTargetLanguage: false,
            },
            {
              language: 'es',
              text: 'Hola mundo',
              isBaseLanguage: false,
              isTargetLanguage: true,
            },
          ],
        })}
        reviewCount={3}
      >
        {({ baseTranslations, targetTranslations }) => (
          <div
            data-testid="card-children"
            data-base={baseTranslations.map((tr) => tr.language).join(',')}
            data-target={targetTranslations.map((tr) => tr.language).join(',')}
          />
        )}
      </CardShell>,
    );

    // Default (non-bare) layout wraps the card in a <main> scroller.
    expect(screen.getByRole('main')).toBeInTheDocument();
    // Header badge (next-intl stub returns the key).
    expect(screen.getByText('reviewCount')).toBeInTheDocument();
    // The base-language row renders its text (via ClickableWords).
    expect(screen.getByRole('main').textContent).toContain('Hello world');
    // Children get the filtered split, not the raw translations array.
    const body = screen.getByTestId('card-children');
    expect(body.dataset.base).toBe('en');
    expect(body.dataset.target).toBe('es');
  });

  it('falls back to the raw source text when there is no base translation, and bare skips the <main> wrapper', () => {
    render(
      <CardShell
        presentation={makePresentation({ sourceText: 'Hola mundo' })}
        reviewCount={0}
        bare
      >
        {() => <div data-testid="card-children" />}
      </CardShell>,
    );

    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.getByText('Hola mundo')).toBeInTheDocument();
    expect(screen.getByTestId('card-children')).toBeInTheDocument();
  });
});
