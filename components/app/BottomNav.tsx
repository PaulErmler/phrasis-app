'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Home, FileText, Play, Library, Settings, Loader2 } from 'lucide-react';

export type View = 'home' | 'content' | 'library' | 'settings';

interface BottomNavProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export function BottomNav({ currentView, onViewChange }: BottomNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('AppPage');
  const [isNavigating, setIsNavigating] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timerRef.current);
    setIsNavigating(false);
  }, [pathname]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleGoToLearn = useCallback(() => {
    router.push('/app/learn');
    timerRef.current = setTimeout(() => setIsNavigating(true), 500);
  }, [router]);

  return (
    <nav className="shrink-0 w-full bg-background/80 backdrop-blur-md border-t border-border/50">
      <div className="container mx-auto">
        <div className="grid grid-cols-5 items-center h-16 relative">
          <div className="flex justify-center">
            <Button
              variant="ghost"
              className={`flex flex-col items-center gap-1 h-auto w-full py-2 hover:bg-transparent ${currentView === 'home' ? 'text-primary' : 'text-muted-foreground'}`}
              onClick={() => onViewChange('home')}
            >
              <Home className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">
                {t('views.home')}
              </span>
            </Button>
          </div>

          <div className="flex justify-center">
            <Button
              variant="ghost"
              className={`flex flex-col items-center gap-1 h-auto w-full py-2 hover:bg-transparent ${currentView === 'content' ? 'text-primary' : 'text-muted-foreground'}`}
              onClick={() => onViewChange('content')}
            >
              <FileText className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">
                {t('views.content')}
              </span>
            </Button>
          </div>

          {/* Central Play Button */}
          <div className="flex justify-center relative h-full">
            <div className="absolute top-0 -translate-y-1/2">
              <Button
                size="icon"
                className="h-14 w-14 rounded-full shadow-xl bg-primary hover:bg-primary/90 transition-transform hover:scale-105 active:scale-95"
                onClick={handleGoToLearn}
                disabled={isNavigating}
              >
                {isNavigating ? (
                  <Loader2 className="h-6 w-6 animate-spin text-primary-foreground" />
                ) : (
                  <Play className="h-6 w-6 fill-current text-primary-foreground" />
                )}
              </Button>
            </div>
          </div>

          <div className="flex justify-center">
            <Button
              variant="ghost"
              className={`flex flex-col items-center gap-1 h-auto w-full py-2 hover:bg-transparent ${currentView === 'library' ? 'text-primary' : 'text-muted-foreground'}`}
              onClick={() => onViewChange('library')}
            >
              <Library className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">
                {t('views.library')}
              </span>
            </Button>
          </div>

          <div className="flex justify-center">
            <Button
              variant="ghost"
              className={`flex flex-col items-center gap-1 h-auto w-full py-2 hover:bg-transparent ${currentView === 'settings' ? 'text-primary' : 'text-muted-foreground'}`}
              onClick={() => onViewChange('settings')}
            >
              <Settings className="h-5 w-5" />
              <span className="text-[10px] font-medium leading-none">
                {t('views.settings')}
              </span>
            </Button>
          </div>
        </div>
      </div>
    </nav>
  );
}
