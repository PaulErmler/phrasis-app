import { useTranslations } from "next-intl";


export function WelcomeStep() {
  const t = useTranslations("Onboarding.welcome");

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="text-center space-y-4">

        <h1 className="text-4xl font-bold">{t("title")}</h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          {t("subtitle")}
        </p>
      </div>


    </div>
  );
}

