"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { SignedIn, SignedOut, UserButton } from "@daveyplate/better-auth-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { Footer } from "@/components/Footer";
import { Bell, BellOff, BellRing } from "lucide-react";

export default function AppPage() {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();

  useEffect(() => {
    if (!session && !isPending) {
      router.push("/");
    }
  }, [session, isPending, router]);

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" />
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
          <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <span className="text-sm font-bold text-white">P</span>
            </div>
            <span className="font-semibold text-lg">Phrasis</span>
          </div>
          <div className="flex items-center gap-4">
            <SignedIn>
              <UserButton size="icon"  />
            </SignedIn>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container mx-auto px-4 py-8">
        <SignedOut>
          <div className="text-center py-12">
            <p className="text-muted-foreground">Redirecting to sign in...</p>
          </div>
        </SignedOut>

        <SignedIn>
          <Content />
        </SignedIn>
      </main>

      {/* Footer */}
      <Footer />

      {/* Background Pattern */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/2 -right-1/2 w-[800px] h-[800px] rounded-full bg-linear-to-br from-emerald-100/30 to-teal-100/30 dark:from-emerald-900/10 dark:to-teal-900/10 blur-3xl" />
      </div>
    </div>
  );
}

function Content() {
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
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" />
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
          <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
          <p className="ml-2 text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold">
          Welcome{viewer ? `, ${viewer}` : ""}!
        </h1>
        <p className="text-muted-foreground">
          You&apos;re signed in to Phrasis
        </p>
      </div>

      {/* Notification Card */}
      <Card className="border-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <BellRing className="h-5 w-5 text-emerald-500" />
            Notifications
          </CardTitle>
          <CardDescription>
            {notificationPermission === "unsupported"
              ? "Notifications are not supported in this browser"
              : notificationPermission === "granted"
                ? "Send yourself a test notification"
                : "Enable notifications to get practice reminders"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {notificationPermission === "unsupported" ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <BellOff className="h-4 w-4" />
              <span className="text-sm">Notifications not available</span>
            </div>
          ) : notificationPermission === "denied" ? (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3">
              <p className="text-sm text-destructive">
                Notifications are blocked. Please enable them in your browser settings.
              </p>
            </div>
          ) : (
            <Button
              onClick={sendTestNotification}
              disabled={isLoading}
              variant={notificationPermission === "granted" ? "default" : "outline"}
              className={
                notificationPermission === "granted"
                  ? "w-full bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200"
                  : "w-full"
              }
            >
              {isLoading ? (
                "Requesting permission..."
              ) : notificationPermission === "granted" ? (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  Send Test Notification
                </>
              ) : (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  Enable Notifications
                </>
              )}
            </Button>
          )}

          {notificationPermission === "granted" && (
            <p className="text-xs text-muted-foreground text-center">
              ✓ Notifications enabled
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">Random Number Generator</CardTitle>
          <CardDescription>
            Click the button to generate and store a random number
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => addNumber({ value: Math.floor(Math.random() * 100) })}
            className="w-full bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200"
          >
            + Generate Random Number
          </Button>

          <div className="rounded-xl bg-muted/50 border border-border/50 p-4">
            <p className="text-sm font-medium text-muted-foreground mb-2">Recent Numbers</p>
            <p className="font-mono text-lg">
              {numbers?.length === 0
                ? "No numbers yet — click the button!"
                : numbers?.join(", ") ?? "..."}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

