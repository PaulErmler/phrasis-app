"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { SignedIn, SignedOut, UserButton, RedirectToSignIn } from "@daveyplate/better-auth-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Footer } from "@/components/Footer";
import { Bell, BellOff, BellRing } from "lucide-react";

export default function AppPage() {

  return (
    <>
      <RedirectToSignIn />
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
    </>
  );
}

function Content() {
  const router = useRouter();
  const { viewer, numbers } = useQuery(api.myFunctions.listNumbers, { count: 10 }) ?? {};
  const addNumber = useMutation(api.myFunctions.addNumber);
  const currentUser = useQuery(api.auth.getCurrentUser);
  const userId = currentUser?._id;
  const cardStats = useQuery(api.cardActions.getCardStats, userId ? { userId } : "skip");
  const addBasicCards = useAction(api.seedCards.addBasicCards);
  
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingCards, setIsAddingCards] = useState(false);

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

  // Show loading while checking authentication
  if (currentUser === undefined) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-bounce" />
          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
          <div className="w-2 h-2 bg-emerald-600 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
          <p className="ml-2 text-muted-foreground">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  // Show message while redirecting
  if (currentUser === null) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-lg text-muted-foreground">Authentication required</p>
          <p className="text-sm text-muted-foreground">Redirecting to login page...</p>
        </div>
      </div>
    );
  }

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

      {/* Learning Deck Stats */}
      <Card className="border-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">📚 Your Learning Deck</CardTitle>
          <CardDescription>
            Track your progress and manage your cards
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cardStats ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-center">
                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{cardStats.totalCards}</p>
                <p className="text-xs text-muted-foreground">Total Cards</p>
              </div>
              <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 p-3 text-center">
                <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">{cardStats.dueCount}</p>
                <p className="text-xs text-muted-foreground">Due Now</p>
              </div>
              <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-3 text-center">
                <p className="text-2xl font-bold text-green-600 dark:text-green-400">{cardStats.reviewsToday}</p>
                <p className="text-xs text-muted-foreground">Reviewed Today</p>
              </div>
              <div className="rounded-lg bg-purple-50 dark:bg-purple-950/30 p-3 text-center">
                <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{cardStats.newCount}</p>
                <p className="text-xs text-muted-foreground">New Cards</p>
              </div>
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-4">
              Loading stats...
            </div>
          )}
          {cardStats && cardStats.totalCards === 0 && (
            <Button
              onClick={async () => {
                if (!userId) return;
                try {
                  setIsAddingCards(true);
                  await addBasicCards({ userId });
                } catch (error) {
                  console.error("Error adding cards:", error);
                } finally {
                  setIsAddingCards(false);
                }
              }}
              disabled={isAddingCards}
              className="w-full bg-linear-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white shadow-lg shadow-purple-500/25"
            >
              {isAddingCards ? "Adding cards..." : "✨ Add Essential Sentences to Start"}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">Flashcard Practice</CardTitle>
          <CardDescription>
            Practice with flashcards and translations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            onClick={() => router.push("/flashcard")}
            className="w-full bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200"
          >
            Go to Flashcard
          </Button>
          <Button
            onClick={() => router.push("/audio-flashcard")}
            className="w-full bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200"
          >
            Go to Audio Flashcard
          </Button>
          <Button
            onClick={() => router.push("/audio-learning")}
            className="w-full bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200"
          >
            Go to Audio Learning
          </Button>
          <Button
            onClick={() => router.push("/audio-spaced")}
            className="w-full bg-linear-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25 transition-all duration-200"
          >
            Go to Spaced Repetition
          </Button>
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

