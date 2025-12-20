import { getTranslations } from "next-intl/server";
import { Footer } from "@/components/Footer";
import { CTAButtons } from "@/components/home/cta-buttons";
import { GoToAppButton } from "@/components/home/go-to-app-button";
import { getToken } from "@/lib/auth-server";

export default async function Home() {
  const t = await getTranslations("HomePage");
  const token = await getToken();
  const isAuthenticated = !!token;

  return (
    <main className="min-h-screen flex flex-col">
      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-20 md:py-32">
        <div className="w-full max-w-4xl mx-auto text-center space-y-8">
          {/* Logo */}
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-foreground shadow-lg shadow-foreground/5">
            <span className="text-4xl font-bold text-background">P</span>
          </div>

          {/* Heading */}
          <div className="space-y-4">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-foreground">
              {t("title")}
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto">
              {t("subtitle")}
            </p>
          </div>

          {/* CTA Buttons */}
          <CTAButtons isAuthenticated={isAuthenticated} />
        </div>
      </section>

      {/* Auth Form Section */}
      <section className="w-full py-16 md:py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-8 lg:gap-12 items-start">
            {/* Left side - Content */}
            <div className="space-y-6">
              <div className="space-y-4">
                <h2 className="text-3xl md:text-4xl font-bold text-foreground">
                  {t("journeySection.title")}
                </h2>
                <p className="text-lg text-muted-foreground">
                  {t("journeySection.description")}
                </p>
              </div>
              <div className="space-y-3 pt-4">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{t("features.learnAtPace.title")}</p>
                    <p className="text-sm text-muted-foreground">{t("features.learnAtPace.description")}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{t("features.trackProgress.title")}</p>
                    <p className="text-sm text-muted-foreground">{t("features.trackProgress.description")}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-2 h-2 rounded-full bg-foreground" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{t("features.multipleLanguages.title")}</p>
                    <p className="text-sm text-muted-foreground">{t("features.multipleLanguages.description")}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Right side - Go to App Button or Sign Up prompt */}
            <div className="w-full">
              <GoToAppButton isAuthenticated={isAuthenticated} />
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <div className="mt-auto">
        <Footer />
      </div>

      {/* Subtle Background Pattern */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-muted/20 blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/2 w-[600px] h-[600px] rounded-full bg-muted/10 blur-3xl" />
      </div>
    </main>
  );
}
