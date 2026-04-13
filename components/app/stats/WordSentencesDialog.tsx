'use client';

import { usePaginatedQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AudioButton } from '@/components/app/learning/AudioButton';
import { getLanguageShortLabel } from '@/lib/languages';

function highlightWord(text: string, word: string): React.ReactNode {
  // Match whole words only. Use Unicode-aware lookbehind/lookahead so that
  // searching for "ich" doesn't highlight the "ich" inside "Sicherheit".
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`,
    'giu',
  );
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} className="text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/** Strip _latam suffix for comparison */
function normalizeLang(code: string): string {
  return code.replace(/_latam$/, '');
}

export function WordSentencesDialog({
  word,
  displayWord,
  language,
  open,
  onOpenChange,
}: {
  word: string;
  displayWord: string;
  language: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.features.stats.getSentencesForWord,
    open ? { word, language } : 'skip',
    { initialNumItems: 10 },
  );

  const normalizedLang = normalizeLang(language);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] flex flex-col sm:max-w-xl p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>{displayWord}</DialogTitle>
          <DialogDescription className="sr-only">
            Sentences containing the word {displayWord}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto min-h-0 px-6 pb-6">
          <div className="space-y-3">
            {status === 'LoadingFirstPage' && (
              <p className="text-sm text-muted-foreground">Loading...</p>
            )}
            {results.map((sentence) => {
              const baseTranslations = sentence.translations.filter(
                (t) => t.isBaseLanguage && t.text,
              );
              const targetTranslations = sentence.translations.filter(
                (t) => t.isTargetLanguage && t.text,
              );

              return (
                <div
                  key={sentence.textId}
                  className="rounded-md border p-3 space-y-2"
                >
                  {/* Base language translations */}
                  {baseTranslations.map((tr) => {
                    const audio = sentence.audioRecordings.find(
                      (a) => a.language === tr.language,
                    );
                    const isWordLanguage =
                      normalizeLang(tr.language) === normalizedLang;
                    return (
                      <div key={tr.language} className="flex items-start gap-1">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-muted-foreground">
                            {isWordLanguage
                              ? highlightWord(tr.text, word)
                              : tr.text}
                          </p>
                          {tr.romanization && (
                            <p className="text-xs text-muted-foreground/70 italic">
                              {tr.romanization}
                            </p>
                          )}
                        </div>
                        {audio && (
                          <AudioButton
                            url={audio.url}
                            language={getLanguageShortLabel(tr.language)}
                          />
                        )}
                      </div>
                    );
                  })}

                  {/* Target language translations */}
                  {targetTranslations.map((tr) => {
                    const audio = sentence.audioRecordings.find(
                      (a) => a.language === tr.language,
                    );
                    const isWordLanguage =
                      normalizeLang(tr.language) === normalizedLang;
                    return (
                      <div key={tr.language} className="flex items-start gap-1">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold">
                            {isWordLanguage
                              ? highlightWord(tr.text, word)
                              : tr.text}
                          </p>
                          {tr.romanization && (
                            <p className="text-xs text-muted-foreground italic">
                              {tr.romanization}
                            </p>
                          )}
                        </div>
                        {audio && (
                          <AudioButton
                            url={audio.url}
                            language={getLanguageShortLabel(tr.language)}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {results.length === 0 && status === 'Exhausted' && (
              <p className="text-sm text-muted-foreground">
                No sentences found for this word yet.
              </p>
            )}
            {status === 'CanLoadMore' && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => loadMore(10)}
              >
                Load more
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
