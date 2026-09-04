import fs from 'fs';
import path from 'path';

const CONTENT_PATH = path.join(process.cwd(), 'content');

export type ContentMetadata = { title: string; lastUpdated: string };

/**
 * Parse the `---` front matter block off a markdown file.
 *
 * Hand-rolled on purpose. The only consumer is `content/legal/**` (six files,
 * two string fields each), and the previous parser, gray-matter, pinned a
 * js-yaml 3 API (`safeLoad`) that the lockfile no longer resolves: pnpm's
 * js-yaml security overrides pushed it to js-yaml 4, where that function is
 * gone, so every `/legal/*` page rendered 404 in fresh installs. It was also
 * the only path to two high-severity js-yaml advisories in `pnpm audit`.
 * Twenty lines of parsing versus a YAML engine for `title:` and
 * `lastUpdated:` is the right trade.
 *
 * Supports `key: value` with optional single or double quotes, `#` comments,
 * blank lines and CRLF. Anything fancier (nested keys, lists, multi-line
 * scalars) is not front matter this repo has, and would be a silent
 * misparse, so keep the legal files flat.
 */
export function parseFrontMatter(raw: string): {
  data: Record<string, string>;
  content: string;
} {
  const text = raw.replace(/\r\n/g, '\n');
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) return { data: {}, content: text };

  const data: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value = trimmed.slice(colon + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith("'") && value.endsWith("'")) ||
        (value.startsWith('"') && value.endsWith('"')))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, content: text.slice(match[0].length) };
}

export async function getContent(
  category: string,
  locale: string,
  slug: string,
): Promise<{ metadata: ContentMetadata; content: string } | null> {
  try {
    const filePath = path.join(CONTENT_PATH, category, locale, `${slug}.md`);

    if (!fs.existsSync(filePath)) return null;

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data, content } = parseFrontMatter(fileContent);

    return {
      metadata: {
        title: data.title ?? '',
        lastUpdated: data.lastUpdated ?? '',
      },
      content,
    };
  } catch {
    return null;
  }
}
