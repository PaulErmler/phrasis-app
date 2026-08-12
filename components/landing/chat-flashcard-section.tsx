'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import {
  ChatFlashcardDemo,
  ChatDemoContextCard,
} from '@/components/landing/chat-flashcard-demo';

export function ChatFlashcardSection() {
  const t = useTranslations('LandingPage.chatDemo');

  return (
    <section
      id="ai-chat"
      className="relative py-20 md:py-32 px-4 sm:px-6 bg-muted/20"
    >
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-[3fr_4fr] gap-10 lg:gap-16 items-start">
          {/* Text column */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: 'easeOut' as const }}
            className="space-y-5"
          >
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
              {t('title')}{' '}
              <span className="text-primary">{t('titleHighlight')}</span>
            </h2>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
              {t('subtitle')}
            </p>
            <div className="space-y-3 pt-2">
              <p className="text-sm font-medium text-muted-foreground">
                {t('contextTitle')}
              </p>
              <ChatDemoContextCard />
              <p className="text-sm text-muted-foreground leading-relaxed">
                {t('contextNote')}
              </p>
            </div>
          </motion.div>

          {/* Demo column */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' as const }}
            className="min-w-0"
          >
            <ChatFlashcardDemo />
          </motion.div>
        </div>
      </div>
    </section>
  );
}
