"use client";

import { ThemeSwitcher } from "./ThemeSwitcher";

export function Footer() {
  return (
    <footer className="w-full border-t border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Phrasis. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">Theme:</span>
            <ThemeSwitcher />
          </div>
        </div>
      </div>
    </footer>
  );
}

