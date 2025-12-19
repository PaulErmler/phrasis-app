"use client";

import { useTranslations } from "next-intl";
import { UserButton } from "@daveyplate/better-auth-ui";
import { Card, CardContent } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export function SettingsView() {
  const t = useTranslations("AppPage");
  return (
    <div className="max-w-xl mx-auto">
      <div className="text-center space-y-2 mb-6" />
      <Card>
        <CardContent className="p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("settings.account")}</label>
            <div className="flex items-center gap-2">
              <UserButton size="icon" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("settings.language")}</label>
            <LanguageSwitcher />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

