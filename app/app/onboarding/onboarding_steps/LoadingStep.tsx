"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";


interface LoadingStepProps {
  onComplete: () => void;
}

export function LoadingStep({ onComplete }: LoadingStepProps) {
  const t = useTranslations("Onboarding.finished");


  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-8 animate-in fade-in zoom-in duration-700">

      
      <div className="text-center space-y-3 max-w-md mx-auto">
        <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-xl text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="pt-4">
        <Button 
          size="lg" 
          onClick={onComplete}
          className="h-14 px-8 text-lg gap-2 rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-105 active:scale-95"
        >
          {t("button")}
          <ArrowRight className="h-5 w-5" />
        </Button>
      </div>
    </div>
  );
}

