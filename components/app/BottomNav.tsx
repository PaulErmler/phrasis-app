'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Home, FileText, Play, Library, Settings, Loader2 } from 'lucide-react';

export type View = 'home' | 'content' | 'library' | 'settings';

const VIEW_PATHS: Record<View, string> = {
  home: '/app',
  content: '/app/content',
  library: '/app/library',
  settings: '/app/settings',
};

const NAV_ITEMS: { view: View; icon: typeof Home; labelKey: string }[] = [
  { view: 'home', icon: Home, labelKey: 'views.home' },
  { view: 'content', icon: FileText, labelKey: 'views.content' },
];

const NAV_ITEMS_RIGHT: { view: View; icon: typeof Home; labelKey: string }[] = [
  { view: 'library', icon: Library, labelKey: 'views.library' },
  { view: 'settings', icon: Settings, labelKey: 'views.settings' },
];

interface BottomNavProps {
  currentView: View;
}

export function BottomNav({ currentView }: BottomNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations('AppPage');
  const [isNavigatingToLearn, setIsNavigatingToLearn] = useState(false);
  const [optimisticView, setOptimisticView] = useState<View | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const activeView = optimisticView ?? currentView;

  useEffect(() => {
    clearTimeout(timerRef.current);
    setIsNavigatingToLearn(false);
    setOptimisticView(null);
  }, [pathname]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handleGoToLearn = useCallback(() => {
    router.push('/app/learn');
    timerRef.current = setTimeout(() => setIsNavigatingToLearn(true), 500);
  }, [router]);

  const renderNavLink = ({ view, icon: Icon, labelKey }: { view: View; icon: typeof Home; labelKey: string }) => (
    <div key={view} className="flex justify-center">
      <Link
        href={VIEW_PATHS[view]}
        onClick={() => setOptimisticView(view)}
        className={`flex flex-col items-center gap-1 h-auto w-full py-2 rounded-md transition-colors ${activeView === view ? 'text-primary' : 'text-muted-foreground'}`}
      >
        <Icon className="h-5 w-5" />
        <span className="text-[10px] font-medium leading-none">
          {t(labelKey)}
        </span>
      </Link>
    </div>
  );

  return (
    <nav className="shrink-0 w-full bg-background/80 backdrop-blur-md border-t border-border/50">
      <div className="container mx-auto">
        <div className="grid grid-cols-5 items-center h-16 relative">
          {NAV_ITEMS.map(renderNavLink)}

          {/* Central Play Button */}
          <div className="flex justify-center relative h-full">
            <div className="absolute top-0 -translate-y-1/2">
              <Button
                size="icon"
                className="h-14 w-14 rounded-full shadow-xl bg-primary hover:bg-primary/90 transition-transform hover:scale-105 active:scale-95"
                onClick={handleGoToLearn}
                disabled={isNavigatingToLearn}
              >
                {isNavigatingToLearn ? (
                  <Loader2 className="h-6 w-6 animate-spin text-primary-foreground" />
                ) : (
                  <Play className="h-6 w-6 fill-current text-primary-foreground" />
                )}
              </Button>
            </div>
          </div>

          {NAV_ITEMS_RIGHT.map(renderNavLink)}
        </div>
      </div>
    </nav>
  );
}
