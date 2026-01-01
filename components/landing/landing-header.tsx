"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Menu, X, Download, Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

interface LandingHeaderProps {
  isAuthenticated: boolean;
}

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#pricing", label: "Pricing" },
  { href: "#testimonials", label: "Reviews" },
  { href: "#faq", label: "FAQ" },
];

export function LandingHeader({ isAuthenticated }: LandingHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleInstallClick = () => {
    const pwaInstallElement = document.querySelector("pwa-install") as HTMLElement & {
      showDialog: () => void;
    } | null;

    if (pwaInstallElement) {
      pwaInstallElement.showDialog();
    }
    setMobileMenuOpen(false);
  };

  const closeMobileMenu = () => setMobileMenuOpen(false);

  const themeOptions = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
  ];

  return (
    <>
      <header className="absolute top-0 left-0 right-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between h-16 md:h-20">
            {/* Left: Logo + Name */}
            <Link href="/" className="flex items-center gap-2 shrink-0">
              <img
                src="/icons/icon.svg"
                alt="Phrasis"
                className="w-8 h-8 md:w-10 md:h-10"
                width={40}
                height={40}
              />
              <span className="text-xl md:text-2xl font-bold gradient-text hidden sm:inline">
                Phrasis
              </span>
            </Link>

            {/* Center: Navigation links (desktop only) - absolutely centered */}
            <nav className="hidden lg:flex items-center gap-1 absolute left-1/2 -translate-x-1/2">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="px-4 py-2 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground transition-all duration-300 hover:bg-primary/10"
                >
                  {link.label}
                </a>
              ))}
            </nav>

            {/* Right: Actions */}
            <div className="flex items-center gap-1">
              {/* Install button (desktop only) */}
              <button
                onClick={handleInstallClick}
                className="hidden lg:flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium text-muted-foreground hover:text-foreground transition-all duration-300 hover:bg-primary/10"
              >
                <Download className="h-4 w-4" />
                Install
              </button>

              {/* Auth buttons */}
              {isAuthenticated ? (
                <Button asChild size="sm" className="hidden sm:inline-flex">
                  <Link href="/app">Go to App</Link>
                </Button>
              ) : (
                <>
                  <Link
                    href="/auth/sign-in"
                    className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-2"
                  >
                    Sign in
                  </Link>
                  <Button asChild size="sm" className="shadow-lg shadow-primary/20">
                    <Link href="/auth/sign-up">Sign up</Link>
                  </Button>
                </>
              )}

              {/* Language switcher (desktop only) */}
              <div className="hidden lg:block">
                <LanguageSwitcher compact />
              </div>

              {/* Theme switcher (desktop only) */}
              <div className="hidden lg:block">
                <ThemeSwitcher />
              </div>

              {/* Mobile menu button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-primary/10 transition-all"
                aria-label="Toggle menu"
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

        {/* Mobile menu panel - expands from top */}
        <div
          className={`absolute top-full left-0 right-0 lg:hidden transition-all duration-300 ease-out overflow-hidden ${
            mobileMenuOpen
              ? "opacity-100 max-h-[500px]"
              : "opacity-0 max-h-0 pointer-events-none"
          }`}
        >
          <div className="mx-4 mt-2 p-2 rounded-2xl bg-background border border-border">
            <nav className="flex flex-col">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  onClick={closeMobileMenu}
                  className="px-4 py-3 rounded-xl text-base font-medium text-foreground hover:bg-primary/10 transition-all"
                >
                  {link.label}
                </a>
              ))}
              
              <div className="h-px bg-border my-1 mx-2" />
              
              <button
                onClick={handleInstallClick}
                className="px-4 py-3 rounded-xl text-base font-medium text-foreground hover:bg-primary/10 transition-all w-full text-left"
              >
                Install App
              </button>

              <div className="px-4 py-2">
                <span className="text-sm text-muted-foreground">Theme</span>
                <div className="flex gap-1 mt-2">
                  {themeOptions.map((option) => {
                    const isActive = mounted && theme === option.value;
                    return (
                      <button
                        key={option.value}
                        onClick={() => setTheme(option.value)}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                          isActive
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:bg-primary/10 hover:text-foreground"
                        }`}
                      >
                        <option.icon className="h-4 w-4" />
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="px-4 py-3 rounded-xl hover:bg-primary/10 transition-all">
                <LanguageSwitcher className="border-0 bg-transparent p-0 h-auto shadow-none text-base font-medium" />
              </div>
            </nav>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          onClick={closeMobileMenu}
        />
      )}
    </>
  );
}

