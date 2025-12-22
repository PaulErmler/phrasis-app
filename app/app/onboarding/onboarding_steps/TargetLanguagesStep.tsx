import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TargetLanguagesStepProps {
  selectedLanguages: string[];
  onToggleLanguage: (languageCode: string) => void;
}

export function TargetLanguagesStep({
  selectedLanguages,
  onToggleLanguage,
}: TargetLanguagesStepProps) {
  const t = useTranslations("Onboarding.step2");

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>
      
      <div className="grid grid-cols-2 gap-3 max-w-2xl mx-auto">
        {SUPPORTED_LANGUAGES.map((language) => {
          const isSelected = selectedLanguages.includes(language.code);
          return (
            <div
              key={language.code}
              role="button"
              tabIndex={0}
              onClick={() => onToggleLanguage(language.code)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onToggleLanguage(language.code);
                }
              }}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "h-auto flex items-center justify-start gap-3 p-3 rounded-xl border-2 transition-all text-left cursor-pointer",
                isSelected
                  ? "border-primary bg-primary/5 shadow-sm hover:bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30 hover:bg-muted/50"
              )}
            >
              <span className="text-2xl shrink-0">{language.flag}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm leading-none truncate">
                  {language.name}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {language.nativeName}
                </p>
              </div>
              <Checkbox checked={isSelected} className="pointer-events-none" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
