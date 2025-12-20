"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

interface CTAButtonsProps {
  isAuthenticated: boolean;
}

export function CTAButtons({ isAuthenticated }: CTAButtonsProps) {
  const router = useRouter();
  const t = useTranslations("HomePage");

  if (isAuthenticated) {
    return (
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
        <Button
          onClick={() => router.push("/app")}
          size="lg"
          className="w-full sm:w-auto min-w-[200px] text-base h-12 shadow-xl shadow-black/5"
        >
          {t("goToApp")}
        </Button>
      </div>
    );
  }

  return (
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
        className="w-full sm:w-auto min-w-[160px] text-base h-12 shadow-xl shadow-black/5"
      >
        {t("getStarted")}
      </Button>
    </div>
  );
}

