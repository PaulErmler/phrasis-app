"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { LogOut } from "lucide-react";

export function SettingsView() {
  const t = useTranslations("AppPage");
  const tAuth = useTranslations("Auth");
  return (
    <div className="max-w-xl mx-auto">
      <div className="text-center space-y-2 mb-6" />
      <Card>
        <CardContent className="p-6 space-y-6">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("settings.account")}</label>
            <div className="flex items-center gap-2">
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={() => authClient.signOut({
                  fetchOptions: {
                    onSuccess: () => {
                      window.location.href = "/";
                    }
                  }
                })}
              >
                <LogOut className="size-4 mr-2" />
                {tAuth("SIGN_OUT")}
              </Button>
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

