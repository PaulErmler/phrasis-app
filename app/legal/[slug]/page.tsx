import { getContent } from '@/lib/content';
import { getUserLocale } from '@/i18n/locale';
import ReactMarkdown from 'react-markdown';
import { notFound } from 'next/navigation';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const locale = await getUserLocale();
  const data = await getContent('legal', locale, slug);

  if (!data) return notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 flex flex-col">
        <div className="max-w-3xl mx-auto py-20 px-6 w-full">
          <header className="mb-10 border-b pb-6">
            <h1 className="text-4xl font-bold mb-2">{data.metadata.title}</h1>
            <p className="text-muted-sm">
              {locale === 'de' ? 'Zuletzt aktualisiert: ' : 'Last updated: '}
              {data.metadata.lastUpdated}
            </p>
          </header>

          <article className="space-y-6 text-foreground">
            <ReactMarkdown
              components={{
                br: () => <br />,
                h1: ({ children }) => (
                  <h1 className="text-3xl font-bold text-foreground mt-8 mb-4">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-2xl font-bold text-foreground mt-6 mb-3">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-xl font-semibold text-foreground mt-4 mb-2">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="text-base text-foreground leading-7 mb-4">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside space-y-2 text-foreground mb-4">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside space-y-2 text-foreground mb-4">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="text-base text-foreground leading-7">
                    {children}
                  </li>
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    className="text-foreground underline hover:text-muted-foreground transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {children}
                  </a>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-foreground">
                    {children}
                  </strong>
                ),
                em: ({ children }) => (
                  <em className="italic text-foreground">{children}</em>
                ),
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-muted pl-4 italic text-muted-foreground my-4">
                    {children}
                  </blockquote>
                ),
                code: ({ children }) => (
                  <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-foreground">
                    {children}
                  </code>
                ),
                pre: ({ children }) => (
                  <pre className="bg-muted p-4 rounded-lg overflow-x-auto mb-4">
                    {children}
                  </pre>
                ),
              }}
            >
              {data.content}
            </ReactMarkdown>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}
