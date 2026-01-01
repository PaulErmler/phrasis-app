"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";

export function LibraryView() {
  const t = useTranslations("AppPage");
  return (
    <div className="max-w-xl mx-auto">
      <div className="text-center space-y-2 mb-6" />
      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-muted-foreground">{t("librarySoon")}</p>
        </CardContent>
      </Card>
    </div>
  );
}

