import { getTranslations } from 'next-intl/server';
import { ChatFlashcardDemo } from './chat-flashcard-demo';

export async function ChatFlashcardSection() {
  const t = await getTranslations('LandingPage.chatDemo');

  return (
    <section
      id="ai-chat"
      className="relative py-16 md:py-24 px-4 sm:px-6 border-t border-border/60 bg-muted/20"
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 lg:items-start">
          <header className="space-y-3 md:space-y-4 order-1 lg:order-1 pt-1">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
              {t('title')}{' '}
              <span className="gradient-text">{t('titleHighlight')}</span>
            </h2>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
              {t('subtitle')}
            </p>
          </header>
          <div className="order-2 lg:order-2 w-full">
            <ChatFlashcardDemo />
          </div>
        </div>
      </div>
    </section>
  );
}
