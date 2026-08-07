'use client';

import { ChevronLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SUPPORTED_LANGUAGES } from '@/lib/languages';

/**
 * Language-picker sheet replica — shows the breadth of supported languages
 * (grid continues past the fold on purpose).
 */
export function LanguagesScreen() {
  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden bg-background text-foreground">
      <header className="sheet-header">
        <div className="flex items-center gap-1 min-w-0">
          <Button variant="ghost" size="icon" className="-ml-2 shrink-0">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h1 className="heading-section truncate">Choose a language</h1>
        </div>
        <span className="text-xs text-muted-foreground tabular-nums shrink-0">
          {SUPPORTED_LANGUAGES.length} languages
        </span>
      </header>

      <div className="px-4 pt-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input className="pl-9" readOnly placeholder="Search languages..." />
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-4 pb-4">
        <div className="grid grid-cols-2 gap-2 pt-2">
          {SUPPORTED_LANGUAGES.map((lang) => (
            <div
              key={lang.code}
              className="flex items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5"
            >
              <span className="text-xl leading-none" aria-hidden>
                {lang.flag}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{lang.name}</p>
                {lang.nativeName !== lang.name && (
                  <p className="text-[11px] text-muted-foreground truncate">
                    {lang.nativeName}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
