import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

// Same standalone-render mocks as CardApproval.test.tsx: the module pulls in
// convex hooks and app-data context that this jsdom render has no provider
// for. EntryLines itself touches none of them without an `audio` prop.
vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(async () => ({ scheduled: false })),
  usePreloadedQuery: () => undefined,
}));
vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({ preloadedCourseSettings: {} }),
}));
vi.mock('@/components/feature_tracking/useFeatureQuota', () => ({
  useFeatureQuota: () => ({ isAvailable: true, isLoading: false }),
}));
vi.mock('@/components/feature_tracking/FeatureBadge', () => ({
  FeatureBadge: () => null,
}));
vi.mock('@/components/autumn/paywall-dialog', () => ({ default: () => null }));
vi.mock('@/hooks/use-course-languages', () => ({
  useCourseLanguages: () => ({ baseLanguages: ['en'], targetLanguages: ['ja'] }),
}));
vi.mock('@/components/chat/EditApprovalDialog', () => ({
  EditApprovalDialog: () => null,
}));

import { EntryLines } from '@/components/chat/CardApproval';

/**
 * Ruby on chat card-approval proposals: entryFurigana renders as readings
 * over the proposed ja sentence, the '' sentinel and stale annotations
 * render plain, and the toggle hides it.
 */

const JA = { language: 'ja', text: '毎朝七時に起きます。' };
const EN = { language: 'en', text: 'I get up at seven.' };
const FURIGANA = { ja: '毎朝[まいあさ]七時[しちじ]に起[お]きます。' };

describe('EntryLines: furigana', () => {
  it('renders ruby over the ja entry, plain for others', () => {
    const { container } = render(
      <EntryLines
        baseEntries={[EN]}
        targetEntries={[JA]}
        furiganaByLanguage={FURIGANA}
        showFurigana
      />,
    );
    expect(
      [...container.querySelectorAll('ruby rt')].map((rt) => rt.getAttribute('data-reading')),
    ).toEqual(['まいあさ', 'しちじ', 'お']);
    expect(container.textContent).toContain('I get up at seven.');
  });

  it('renders plain when the toggle is off, the sentinel is stored, or the annotation is stale', () => {
    for (const props of [
      { furiganaByLanguage: FURIGANA, showFurigana: false },
      { furiganaByLanguage: { ja: '' }, showFurigana: true },
      // Annotation for a pre-edit wording no longer reconstructs the text.
      { furiganaByLanguage: { ja: '別[べつ]の文。' }, showFurigana: true },
    ]) {
      const { container, unmount } = render(
        <EntryLines baseEntries={[EN]} targetEntries={[JA]} {...props} />,
      );
      expect(container.querySelectorAll('ruby')).toHaveLength(0);
      expect(container.textContent).toContain(JA.text);
      unmount();
    }
  });
});
