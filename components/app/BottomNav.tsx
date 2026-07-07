'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Home, Play, Library, Settings, BarChart3 } from 'lucide-react';

export type View = 'home' | 'library' | 'stats' | 'settings' | 'chat';

type NavItem = { view: View; href: string; icon: typeof Home; labelKey: string };

const NAV_ITEMS: NavItem[] = [
  { view: 'home', href: '/app', icon: Home, labelKey: 'views.home' },
  { view: 'stats', href: '/app/stats', icon: BarChart3, labelKey: 'views.stats' },
];

const NAV_ITEMS_RIGHT: NavItem[] = [
  { view: 'library', href: '/app/library', icon: Library, labelKey: 'views.library' },
  { view: 'settings', href: '/app/settings', icon: Settings, labelKey: 'views.settings' },
];

function activeViewFromPathname(pathname: string): View {
  if (pathname.startsWith('/app/library')) return 'library';
  if (pathname.startsWith('/app/stats')) return 'stats';
  if (pathname.startsWith('/app/settings')) return 'settings';
  if (pathname.startsWith('/app/chat')) return 'chat';
  return 'home';
}

export function BottomNav() {
  const t = useTranslations('AppPage');
  const pathname = usePathname();
  const currentView = activeViewFromPathname(pathname);

  const renderNavLink = ({ view, href, icon: Icon, labelKey }: NavItem) => (
    <div key={view} className="flex justify-center">
      <Link
        href={href}
        data-testid={`bottom-nav-${view}`}
        aria-label={t(labelKey)}
        className={`flex flex-col items-center gap-1 h-auto w-full py-2 rounded-md transition-colors ${currentView === view ? 'text-primary' : 'text-muted-foreground'}`}
      >
        <Icon className="h-5 w-5" />
        <span className="text-[10px] font-medium leading-none">
          {t(labelKey)}
        </span>
      </Link>
    </div>
  );

  return (
    <nav className="w-full bg-background/80 backdrop-blur-md border-t border-border/50 overflow-visible pb-[env(safe-area-inset-bottom,0px)]">
      <div className="container mx-auto">
        <div className="grid grid-cols-5 items-center h-16 relative">
          {NAV_ITEMS.map(renderNavLink)}

          {/* Central Play Button */}
          <div className="flex justify-center relative h-full">
            <div className="absolute top-0 -translate-y-1/2">
              <Link
                href="/app/learn"
                data-testid="bottom-nav-learn"
                className="flex h-14 w-14 items-center justify-center rounded-full shadow-xl bg-primary hover:bg-primary/90 transition-transform hover:scale-105 active:scale-95"
              >
                <Play className="h-6 w-6 fill-current text-primary-foreground" />
              </Link>
            </div>
          </div>

          {NAV_ITEMS_RIGHT.map(renderNavLink)}
        </div>
      </div>
    </nav>
  );
}
