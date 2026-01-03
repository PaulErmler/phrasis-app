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
  const currentUser = useQuery(api.auth.getCurrentUser);
  const userId = currentUser?._id;
  const userPreferences = useQuery(api.userPreferences.getUserPreferences, userId ? { userId } : "skip");
  const cardStats = useQuery(api.cardActions.getCardStats, userId ? { userId } : "skip");
  const updatePreferencesMutation = useMutation(api.userPreferences.updateUserPreferences);
  const addBasicCards = useAction(api.seedCards.addBasicCards);
  
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingCards, setIsAddingCards] = useState(false);
  const [cardImportCount, setCardImportCount] = useState(10);

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

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-bold">
          Welcome!
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
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-3 text-center">
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{cardStats.totalCards}</p>
                  <p className="text-xs text-muted-foreground">Total Cards</p>
                </div>
                <div className="rounded-lg bg-orange-50 dark:bg-orange-950/30 p-3 text-center">
                  <p className="text-2xl font-bold text-orange-600 dark:text-orange-400">
                    {(cardStats.initialLearningDueNow || 0) + (cardStats.dueCount || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Due Now</p>
                </div>
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-3 text-center">
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">{cardStats.reviewsToday}</p>
                  <p className="text-xs text-muted-foreground">Reviewed Today</p>
                </div>
                <div className="rounded-lg bg-purple-50 dark:bg-purple-950/30 p-3 text-center">
                  <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">
                    {cardStats.initialLearningCount > 0 ? cardStats.initialLearningCount : cardStats.newCount}
                  </p>
                  <p className="text-xs text-muted-foreground">New Cards</p>
                </div>
              </div>
              
              {/* Initial Learning Progress or Continue Learning Button */}
              {cardStats.initialLearningCount > 0 && (
                <div className="rounded-lg bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800 p-4">
                  <p className="text-sm font-semibold text-cyan-900 dark:text-cyan-100 mb-2">
                    📚 Learning Phase: {cardStats.initialLearningCount} cards
                  </p>
                  <p className="text-xs text-cyan-700 dark:text-cyan-300 mb-3">
                    Complete the initial learning phase before FSRS review starts.
                  </p>
                </div>
              )}
              
              {/* Continue/Start Learning Button */}
              {cardStats.totalCards > 0 && (cardStats.initialLearningDueNow > 0 || cardStats.dueCount > 0) && (
                <Button
                  onClick={() => router.push("/audio-spaced")}
                  className="w-full bg-linear-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/25 transition-all duration-200"
                >
                  {cardStats.initialLearningCount > 0 ? "Continue Learning" : "Start Learning"} ({(cardStats.initialLearningDueNow || 0) + (cardStats.dueCount || 0)} due)
                </Button>
              )}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-4">
              Loading stats...
            </div>
          )}
          
        </CardContent>
      </Card>

      {/* Add Cards Section - Always Visible */}
      <Card className="border-border/50 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">➕ Add More Cards</CardTitle>
          <CardDescription>
            Import essential sentences to expand your learning deck
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label htmlFor="cardCount" className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-2">
              Number of cards to import:
            </label>
            <input
              id="cardCount"
              type="number"
              min="1"
              max="100"
              value={cardImportCount}
              onChange={(e) => setCardImportCount(Math.max(1, parseInt(e.target.value) || 10))}
              className="w-full px-3 py-2 border border-border rounded-md bg-white dark:bg-slate-950 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <Button
            onClick={async () => {
              if (!userId) return;
              try {
                setIsAddingCards(true);
                await addBasicCards({ 
                  userId, 
                  count: cardImportCount
                });
              } catch (error) {
                console.error("Error adding cards:", error);
              } finally {
                setIsAddingCards(false);
              }
            }}
            disabled={isAddingCards}
            className="w-full bg-linear-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white shadow-lg shadow-purple-500/25"
          >
            {isAddingCards ? "Adding cards..." : (cardStats?.totalCards === 0 ? `🚀 Start Learning with ${cardImportCount} Sentences` : `✨ Add ${cardImportCount} Essential Sentences`)}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

