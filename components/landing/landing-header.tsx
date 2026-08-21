'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Menu, X, Download, Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { openPwaInstallDialog } from '@/components/landing/open-pwa-install-dialog';

interface LandingHeaderProps {
  isAuthenticated: boolean;
}

export function LandingHeader({ isAuthenticated }: LandingHeaderProps) {
  const t = useTranslations('LandingPage.header');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { href: '#how', label: t('nav.howItWorks') },
    { href: '#features', label: t('nav.features') },
    { href: '#pricing', label: t('nav.pricing') },
    { href: '#faq', label: t('nav.faq') },
  ];

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const handleInstallClick = () => {
    openPwaInstallDialog();
    setMobileMenuOpen(false);
  };

  const themeOptions = [
    { value: 'light', label: t('themeLight'), icon: Sun },
    { value: 'dark', label: t('themeDark'), icon: Moon },
    { value: 'system', label: t('themeSystem'), icon: Monitor },
  ];

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'bg-background/80 backdrop-blur-xl border-b border-border/40 shadow-sm'
            : 'bg-transparent'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5 shrink-0">
              <Image
                src="/icons/icon.svg"
                alt="Flexling"
                className="w-8 h-8 md:w-9 md:h-9"
                width={36}
                height={36}
              />
              <span className="text-xl font-bold hidden sm:inline text-foreground">
                Flexling
              </span>
            </Link>

            {/* Center nav (desktop) */}
            <nav className="hidden lg:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
                >
                  {link.label}
                </a>
              ))}
            </nav>

            {/* Right actions */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleInstallClick}
                className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground transition-colors duration-200"
              >
                <Download className="h-4 w-4" />
                {t('install')}
              </button>

              {isAuthenticated ? (
                <Button asChild size="sm" className="hidden sm:inline-flex rounded-lg">
                  <Link href="/app">{t('goToApp')}</Link>
                </Button>
              ) : (
                <>
                  <Link
                    href="/auth/sign-in"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
                  >
                    {t('signIn')}
                  </Link>
                  <Button
                    asChild
                    size="sm"
                    className="rounded-lg ent-cta-orange font-semibold"
                  >
                    <Link href="/auth/sign-up">{t('signUp')}</Link>
                  </Button>
                </>
              )}

              <div className="hidden lg:block">
                <LanguageSwitcher compact />
              </div>
              <div className="hidden lg:block">
                <ThemeSwitcher />
              </div>

              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
                aria-label={t('nav.menuAriaLabel')}
              >
                {mobileMenuOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        <div
          className={`absolute top-full left-0 right-0 lg:hidden transition-all duration-300 ease-out overflow-hidden ${
            mobileMenuOpen
              ? 'opacity-100 max-h-[500px]'
              : 'opacity-0 max-h-0 pointer-events-none'
          }`}
        >
          <div className="mx-4 mt-2 p-2 rounded-2xl bg-background border border-border shadow-lg">
            <nav className="flex flex-col">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={closeMobileMenu}
                  className="px-4 py-3 rounded-xl text-base font-medium text-foreground hover:bg-muted transition-all"
                >
                  {link.label}
                </a>
              ))}
              <div className="h-px bg-border my-1 mx-2" />
              <button
                onClick={handleInstallClick}
                className="px-4 py-3 rounded-xl text-base font-medium text-foreground hover:bg-muted transition-all w-full text-left"
              >
                {t('installApp')}
              </button>
              <div className="px-4 py-2">
                <span className="text-sm text-muted-foreground">{t('theme')}</span>
                <div className="flex gap-1 mt-2">
                  {themeOptions.map((option) => {
                    const isActive = mounted && theme === option.value;
                    return (
                      <button
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                          isActive
                            ? 'bg-primary/15 text-primary'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                      >
                        <option.icon className="h-4 w-4" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="px-4 py-3 rounded-xl hover:bg-muted transition-all">
                <LanguageSwitcher className="border-0 bg-transparent p-0 h-auto shadow-none text-base font-medium" />
              </div>
            </nav>
          </div>
        </div>
      </header>

      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={closeMobileMenu}
        />
      )}
    </>
  );
}
