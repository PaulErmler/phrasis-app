import { describe, expect, it } from 'vitest';

import { getContent, parseFrontMatter } from '@/lib/content';

describe('parseFrontMatter', () => {
  it('reads quoted and unquoted scalars and strips the block from the body', () => {
    const { data, content } = parseFrontMatter(
      '---\ntitle: \'Privacy Policy\'\nlastUpdated: "2026-09-01"\nslug: privacy\n# a comment\n\n---\n\n# Heading\n\nBody.\n',
    );
    expect(data).toEqual({
      title: 'Privacy Policy',
      lastUpdated: '2026-09-01',
      slug: 'privacy',
    });
    expect(content).toBe('\n# Heading\n\nBody.\n');
  });

  it('tolerates CRLF and a body that is only front matter', () => {
    const { data, content } = parseFrontMatter("---\r\ntitle: 'T'\r\n---\r\n");
    expect(data).toEqual({ title: 'T' });
    expect(content).toBe('');
  });

  it('keeps a colon inside the value', () => {
    const { data } = parseFrontMatter('---\ntitle: Note: draft\n---\n');
    expect(data.title).toBe('Note: draft');
  });

  it('returns the whole text when there is no front matter', () => {
    const { data, content } = parseFrontMatter('# Just markdown\n');
    expect(data).toEqual({});
    expect(content).toBe('# Just markdown\n');
  });
});

describe('getContent', () => {
  it('returns null for a missing file', async () => {
    expect(await getContent('legal', 'en', 'does-not-exist')).toBeNull();
  });

  it.each(['en', 'de'])(
    'loads the real %s privacy policy with its metadata and disclosures',
    async (locale) => {
      const page = await getContent('legal', locale, 'privacy');
      expect(page).not.toBeNull();
      expect(page!.metadata.lastUpdated).toBe('2026-09-01');
      expect(page!.metadata.title).toMatch(
        /Privacy Policy|Datenschutzerklärung/,
      );
      // The policy must name every vendor that stores on the device.
      expect(page!.content).toContain('PostHog');
      expect(page!.content).toContain('__oppref');
      expect(page!.content).toContain('flexling_oaiq_');
      // The front matter must not leak into the rendered body.
      expect(page!.content.startsWith('---')).toBe(false);
    },
  );

  it.each([
    ['en', 'impressum'],
    ['en', 'agb'],
    ['de', 'impressum'],
    ['de', 'agb'],
  ])('loads %s/%s', async (locale, slug) => {
    const page = await getContent('legal', locale, slug);
    expect(page?.metadata.title).toBeTruthy();
    expect(page?.content.length).toBeGreaterThan(100);
  });
});
