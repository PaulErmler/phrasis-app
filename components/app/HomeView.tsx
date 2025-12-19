"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { useTranslations } from "next-intl";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, BellOff, BellRing } from "lucide-react";

export function HomeView() {
  const router = useRouter();
  const t = useTranslations("AppPage");
  const { viewer, numbers } = useQuery(api.myFunctions.listNumbers, { count: 10 }) ?? {};
  const addNumber = useMutation(api.myFunctions.addNumber);
  
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationPermission(Notification.permission);
    } else {
      setNotificationPermission("unsupported");
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    setIsLoading(true);
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const sendTestNotification = useCallback(async () => {
    if (notificationPermission !== "granted") {
      await requestNotificationPermission();
      return;
    }

    // Try to use service worker notification first (works when app is in background)
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("Phrasis", {
        body: "Time to practice your phrases! 🌟",
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-96x96.png",
        tag: "phrasis-reminder",
        data: { url: "/app" },
      });
    } else {
      // Fallback to regular notification
      new Notification("Phrasis", {
        body: "Time to practice your phrases! 🌟",
        icon: "/icons/icon-192x192.png",
        tag: "phrasis-reminder",
      });
    }
  }, [notificationPermission, requestNotificationPermission]);

  if (viewer === undefined || numbers === undefined) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" />
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
          <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
          <p className="ml-2 text-muted-foreground">{t("loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="text-center space-y-2 mb-6">
        <p className="text-muted-foreground">
          {t("welcome", { viewer: viewer || "undefined" })}
        </p>
      </div>

      {/* Notification Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BellRing className="h-5 w-5" />
            {t("notifications.title")}
          </CardTitle>
          <CardDescription>
            {t(`notifications.description.${notificationPermission === "denied" ? "default" : notificationPermission}`)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notificationPermission === "unsupported" ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <BellOff className="h-4 w-4" />
              <span className="text-sm">{t("notifications.notAvailable")}</span>
            </div>
          ) : notificationPermission === "denied" ? (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
              <p className="text-sm text-destructive">
                {t("notifications.blocked")}
              </p>
            </div>
          ) : (
            <Button
              onClick={sendTestNotification}
              disabled={isLoading}
              variant={notificationPermission === "granted" ? "default" : "outline"}
              className="w-full"
            >
              {isLoading ? (
                t("notifications.requesting")
              ) : notificationPermission === "granted" ? (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  {t("notifications.sendTest")}
                </>
              ) : (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  {t("notifications.enable")}
                </>
              )}
            </Button>
          )}

          {notificationPermission === "granted" && (
            <p className="text-xs text-muted-foreground text-center">
              ✓ {t("notifications.enabled")}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("flashcards.title")}</CardTitle>
          <CardDescription>
            {t("flashcards.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => router.push("/flashcard")}
            className="w-full"
          >
            {t("flashcards.goToFlashcard")}
          </Button>
          <Button
            onClick={() => router.push("/audio-flashcard")}
            className="w-full"
            variant="outline"
          >
            {t("flashcards.goToAudioFlashcard")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t("randomNumber.title")}</CardTitle>
          <CardDescription>
            {t("randomNumber.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => addNumber({ value: Math.floor(Math.random() * 100) })}
            className="w-full"
          >
            {t("randomNumber.generate")}
          </Button>

          <div className="rounded-lg bg-muted p-4">
            <p className="text-sm font-medium text-muted-foreground mb-2">{t("randomNumber.recent")}</p>
            <p className="font-mono text-lg">
              {numbers?.length === 0
                ? t("randomNumber.empty")
                : numbers?.join(", ") ?? "..."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

