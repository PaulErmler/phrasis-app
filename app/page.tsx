"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { SignedIn, SignedOut } from "@daveyplate/better-auth-ui";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Footer } from "@/components/Footer";
import { useTranslations } from "next-intl";

export default function Home() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const t = useTranslations("HomePage");

  useEffect(() => {
    if (session && !isPending) {
      router.push("/app");
    }
  }, [session, isPending, router]);

  if (isPending) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" />
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
          <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col">
      <SignedOut>
        {/* Hero Section */}
        <section className="flex-1 flex flex-col items-center justify-center px-4 py-20 md:py-32">
          <div className="w-full max-w-4xl mx-auto text-center space-y-8">
            {/* Logo */}
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-linear-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25">
              <span className="text-4xl font-bold text-white">P</span>
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
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
              <Button
                onClick={() => router.push("/auth/sign-in")}
                size="lg"
                variant="outline"
                className="w-full sm:w-auto min-w-[160px] text-base h-12"
              >
                {t("signIn")}
              </Button>
              <Button
                onClick={() => router.push("/auth/sign-up")}
                size="lg"
                className="w-full sm:w-auto min-w-[160px] text-base h-12 bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25"
              >
                {t("getStarted")}
              </Button>
            </div>
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
                    <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0 mt-0.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{t("features.learnAtPace.title")}</p>
                      <p className="text-sm text-muted-foreground">{t("features.learnAtPace.description")}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0 mt-0.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{t("features.trackProgress.title")}</p>
                      <p className="text-sm text-muted-foreground">{t("features.trackProgress.description")}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0 mt-0.5">
                      <div className="w-2 h-2 rounded-full bg-emerald-600 dark:bg-emerald-400" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground">{t("features.multipleLanguages.title")}</p>
                      <p className="text-sm text-muted-foreground">{t("features.multipleLanguages.description")}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right side - Auth Form */}
              <div className="w-full">
                <AuthCard />
              </div>
            </div>
          </div>
        </section>
      </SignedOut>

      <SignedIn>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-linear-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/25">
              <span className="text-3xl font-bold text-white">P</span>
            </div>
            <h1 className="text-2xl font-semibold">{t("redirecting")}</h1>
          </div>
        </div>
      </SignedIn>

      {/* Footer */}
      <div className="mt-auto">
        <Footer />
      </div>

      {/* Subtle Background Pattern */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-linear-to-br from-emerald-100/40 to-teal-100/40 dark:from-emerald-900/20 dark:to-teal-900/20 blur-3xl" />
        <div className="absolute -bottom-1/2 -left-1/2 w-[600px] h-[600px] rounded-full bg-linear-to-tr from-slate-100/40 to-zinc-100/40 dark:from-slate-900/20 dark:to-zinc-900/20 blur-3xl" />
      </div>
    </main>
  );
}

function AuthCard() {
  const [activeTab, setActiveTab] = useState<"signin" | "signup">("signup");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations("HomePage.authCard");

  // Sign In form state
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");

  // Sign Up form state
  const [signUpName, setSignUpName] = useState("");
  const [signUpEmail, setSignUpEmail] = useState("");
  const [signUpPassword, setSignUpPassword] = useState("");

  // Helper to get localized error message
  const getErrorMessage = (errorCode: string | undefined, fallback: string): string => {
    if (!errorCode) return t("errors.unexpectedError");
    
    // Map common error codes to localized messages
    const lowerCode = errorCode.toLowerCase();
    if (lowerCode.includes("user already exists") || lowerCode.includes("email") && lowerCode.includes("exist")) {
      return t("errors.emailAlreadyExists");
    }
    if (lowerCode.includes("invalid") && (lowerCode.includes("email") || lowerCode.includes("password") || lowerCode.includes("credentials"))) {
      return t("errors.invalidCredentials");
    }
    
    // Return the original message if no mapping found, or fallback
    return errorCode || fallback;
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await authClient.signIn.email({
        email: signInEmail,
        password: signInPassword,
        callbackURL: "/app",
      });

      if (result.error) {
        setError(getErrorMessage(result.error.message, t("errors.signInFailed")));
        setIsLoading(false);
      }
    } catch {
      setError(t("errors.unexpectedError"));
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const result = await authClient.signUp.email({
        email: signUpEmail,
        password: signUpPassword,
        name: signUpName,
        callbackURL: "/app",
      });

      if (result.error) {
        setError(getErrorMessage(result.error.message, t("errors.signUpFailed")));
        setIsLoading(false);
      }
    } catch {
      setError(t("errors.unexpectedError"));
      setIsLoading(false);
    }
  };

  return (
    <Card className="border-border/50 shadow-xl shadow-black/5 sticky top-24">
      <CardHeader className="space-y-1 pb-4">
        <CardTitle className="text-xl font-semibold text-center">
          {activeTab === "signin" ? t("welcomeBack") : t("startLearning")}
        </CardTitle>
        <CardDescription className="text-center">
          {activeTab === "signin" ? t("continueJourney") : t("createAccount")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as "signin" | "signup"); setError(null); }}>
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="signin">{t("signIn")}</TabsTrigger>
            <TabsTrigger value="signup">{t("signUp")}</TabsTrigger>
          </TabsList>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="signin-email" className="text-sm font-medium text-foreground">
                  {t("email")}
                </label>
                <input
                  id="signin-email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={signInEmail}
                  onChange={(e) => setSignInEmail(e.target.value)}
                  required
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="signin-password" className="text-sm font-medium text-foreground">
                  {t("password")}
                </label>
                <input
                  id="signin-password"
                  type="password"
                  placeholder={t("passwordPlaceholder")}
                  value={signInPassword}
                  onChange={(e) => setSignInPassword(e.target.value)}
                  required
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <Button
                type="submit"
                className="w-full bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200"
                disabled={isLoading}
              >
                {isLoading ? t("signingIn") : t("signIn")}
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="signup-name" className="text-sm font-medium text-foreground">
                  {t("name")}
                </label>
                <input
                  id="signup-name"
                  type="text"
                  placeholder={t("namePlaceholder")}
                  value={signUpName}
                  onChange={(e) => setSignUpName(e.target.value)}
                  required
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="signup-email" className="text-sm font-medium text-foreground">
                  {t("email")}
                </label>
                <input
                  id="signup-email"
                  type="email"
                  placeholder={t("emailPlaceholder")}
                  value={signUpEmail}
                  onChange={(e) => setSignUpEmail(e.target.value)}
                  required
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="signup-password" className="text-sm font-medium text-foreground">
                  {t("password")}
                </label>
                <input
                  id="signup-password"
                  type="password"
                  placeholder={t("passwordPlaceholder")}
                  value={signUpPassword}
                  onChange={(e) => setSignUpPassword(e.target.value)}
                  required
                  minLength={8}
                  className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="text-xs text-muted-foreground">{t("passwordHint")}</p>
              </div>
              <Button
                type="submit"
                className="w-full bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200"
                disabled={isLoading}
              >
                {isLoading ? t("creatingAccount") : t("createAccountBtn")}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
