'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Home, FileText, Play, Library, Settings } from 'lucide-react';

export type View = 'home' | 'content' | 'library' | 'settings';

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
  onViewChange: (view: View) => void;
  onLearnOpen: () => void;
}

export function BottomNav({ currentView, onViewChange, onLearnOpen }: BottomNavProps) {
  const t = useTranslations('AppPage');

  const renderNavButton = ({ view, icon: Icon, labelKey }: { view: View; icon: typeof Home; labelKey: string }) => (
    <div key={view} className="flex justify-center">
      <button
        type="button"
        onClick={() => onViewChange(view)}
        className={`flex flex-col items-center gap-1 h-auto w-full py-2 rounded-md transition-colors ${currentView === view ? 'text-primary' : 'text-muted-foreground'}`}
      >
        <Icon className="h-5 w-5" />
        <span className="text-[10px] font-medium leading-none">
          {t(labelKey)}
        </span>
      </button>
    </div>
  );

  return (
    <nav className="shrink-0 w-full bg-background/80 backdrop-blur-md border-t border-border/50">
      <div className="container mx-auto">
        <div className="grid grid-cols-5 items-center h-16 relative">
          {NAV_ITEMS.map(renderNavButton)}

          {/* Central Play Button */}
          <div className="flex justify-center relative h-full">
            <div className="absolute top-0 -translate-y-1/2">
              <Button
                size="icon"
                className="h-14 w-14 rounded-full shadow-xl bg-primary hover:bg-primary/90 transition-transform hover:scale-105 active:scale-95"
                onClick={onLearnOpen}
              >
                <Play className="h-6 w-6 fill-current text-primary-foreground" />
              </Button>
            </div>
          </div>

          {NAV_ITEMS_RIGHT.map(renderNavButton)}
        </div>
      </div>
    </nav>
  );
}
