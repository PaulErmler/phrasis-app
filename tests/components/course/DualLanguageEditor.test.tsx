import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DualLanguageEditor } from '@/components/course/DualLanguageEditor';

// tests/setup.ts stubs next-intl: `t(key)` returns the key, so the search
// box is found by its key placeholder.
const SEARCH = 'searchPlaceholder';

function renderEditor(onChange = vi.fn()) {
  render(
    <DualLanguageEditor
      baseLanguages={['en']}
      targetLanguages={['es']}
      maxPerGroup={2}
      maxTotal={3}
      locale="en"
      onChange={onChange}
    />,
  );
  return onChange;
}

describe('DualLanguageEditor: adding a language', () => {
  it('opens a searchable list and narrows it as the user types', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId('add-language-target-open'));

    const search = screen.getByPlaceholderText(SEARCH);
    expect(screen.getByTestId('language-option-fr')).toBeTruthy();
    expect(screen.getByTestId('language-option-ja')).toBeTruthy();

    await user.type(search, 'japan');
    expect(screen.getByTestId('language-option-ja')).toBeTruthy();
    expect(screen.queryByTestId('language-option-fr')).toBeNull();
  });

  it('matches the native name too', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId('add-language-target-open'));
    await user.type(screen.getByPlaceholderText(SEARCH), '日本');
    expect(screen.getByTestId('language-option-ja')).toBeTruthy();
    expect(screen.queryByTestId('language-option-de')).toBeNull();
  });

  it('adds the picked language to the group and closes the list', async () => {
    const user = userEvent.setup();
    const onChange = renderEditor();
    await user.click(screen.getByTestId('add-language-target-open'));
    await user.click(screen.getByTestId('language-option-ja'));
    expect(onChange).toHaveBeenCalledWith(['en'], ['es', 'ja']);
  });

  it('leaves out languages already in the course', async () => {
    const user = userEvent.setup();
    renderEditor();
    await user.click(screen.getByTestId('add-language-base-open'));
    expect(screen.queryByTestId('language-option-en')).toBeNull();
    expect(screen.queryByTestId('language-option-es')).toBeNull();
  });
});
