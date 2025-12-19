"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Monitor, Moon, Sun } from "lucide-react";

interface ThemeSwitcherProps {
  minimal?: boolean;
}

export function ThemeSwitcher({ minimal = false }: ThemeSwitcherProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const t = useTranslations("Theme");

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return minimal ? (
      <Button variant="ghost" size="icon" disabled>
        <Sun className="size-5 opacity-50" />
      </Button>
    ) : (
      <Select value={theme || ""} disabled>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder={t("title")} />
        </SelectTrigger>
      </Select>
    );
  }

  if (minimal) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="focus-visible:ring-0 focus-visible:ring-offset-0">
            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">{t("toggle")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setTheme("light")}>
            <Sun className="mr-2 h-4 w-4" />
            <span>{t("light")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            <Moon className="mr-2 h-4 w-4" />
            <span>{t("dark")}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            <Monitor className="mr-2 h-4 w-4" />
            <span>{t("system")}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Select value={theme || ""} onValueChange={setTheme}>
      <SelectTrigger className="w-[140px]">
        <SelectValue placeholder={t("title")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="light">
          <div className="flex items-center gap-2">
            <Sun className="size-4" />
            <span>{t("light")}</span>
          </div>
        </SelectItem>
        <SelectItem value="dark">
          <div className="flex items-center gap-2">
            <Moon className="size-4" />
            <span>{t("dark")}</span>
          </div>
        </SelectItem>
        <SelectItem value="system">
          <div className="flex items-center gap-2">
            <Monitor className="size-4" />
            <span>{t("system")}</span>
          </div>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
