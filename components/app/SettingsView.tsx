"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { LogOut, Mail } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { PricingTable } from "autumn-js/react";

export function SettingsView() {
  const t = useTranslations("AppPage");
  const tAuth = useTranslations("Auth");
  const { data: session } = authClient.useSession();
  const userEmail = session?.user?.email;

  return (
    <div className="max-w-xl mx-auto px-4 py-6">
      <Card>

        <CardContent className="space-y-6">
          {/* User Email Section */}
          {userEmail && (
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">
                {t("settings.account") || "Account"}
              </label>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Mail className="size-4 text-muted-foreground" />
                <span className="text-sm">{userEmail}</span>
              </div>
            </div>
          )}

          <Separator />


          {/* Language Section */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-muted-foreground">
              {t("settings.language") || "Language"}
            </label>
            <LanguageSwitcher />
          </div>

          <Separator />

          {/* Sign Out Section */}
          <div className="space-y-2">
            <Button 
              variant="destructive" 
              className="w-full"
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
        </CardContent>
      </Card>

      <PricingTable/>
    </div>
  );
}

