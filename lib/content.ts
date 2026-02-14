import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const CONTENT_PATH = path.join(process.cwd(), 'content');

export async function getContent(
  category: string,
  locale: string,
  slug: string,
) {
  const filePath = path.join(CONTENT_PATH, category, locale, `${slug}.md`);

  if (!fs.existsSync(filePath)) return null;

  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, content } = matter(fileContent);

  return {
    metadata: data as { title: string; lastUpdated: string },
    content,
  };
}
