"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, BellOff, BellRing } from "lucide-react";
import { getLanguagesByCodes } from "@/lib/languages";
import { NewChatInput } from "@/components/chat/NewChatInput";

export function HomeView() {
  const router = useRouter();
  const t = useTranslations("AppPage");
  const activeCourse = useQuery(api.courses.getActiveCourse);
  const currentUser = useQuery(api.auth.getCurrentUser);
  const userId = currentUser?._id;
  const userPreferences = useQuery(api.userPreferences.getUserPreferences, userId ? { userId } : "skip");
  const cardStats = useQuery(api.cardActions.getCardStats, userId ? { userId } : "skip");
  const availableDatasets = useQuery(api.cardImportRequests.getAvailableDatasets);
  const csvFile = useQuery(api.fileUpload.getCSVFile, { name: "Essential" });
  const requestCardImport = useMutation(api.cardImportRequests.requestCardImport);
  
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");
  const [isLoading, setIsLoading] = useState(false);
  const [isAddingCards, setIsAddingCards] = useState(false);
  const [cardImportCount, setCardImportCount] = useState(10);
  const [selectedDataset, setSelectedDataset] = useState<string | undefined>(undefined);
  const [datasets, setDatasets] = useState<Array<{id: string; name: string}>>([]);

  // Update datasets and selectedDataset when availableDatasets loads
  useEffect(() => {
    if (availableDatasets && Array.isArray(availableDatasets) && availableDatasets.length > 0) {
      setDatasets(availableDatasets);
      if (!selectedDataset) {
        setSelectedDataset(availableDatasets[0].name);
      }
    }
  }, [availableDatasets, selectedDataset]);

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

  const formatCourseName = () => {
    if (!activeCourse) return null;
    const targetLanguageObjects = getLanguagesByCodes(activeCourse.targetLanguages);
    const targetNames = targetLanguageObjects.map((l) => l.name).join(", ");
    return targetNames;
  };

  const courseName = formatCourseName();

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Current Course Display */}
      {courseName && (
        <div className="text-center py-2">
          <p className="text-sm text-muted-foreground">{t("courses.currentCourse")}</p>
          <h2 className="text-2xl font-bold mt-1">{courseName}</h2>
        </div>
      )}

      {/* New Chat Input */}
      <NewChatInput 
        showSuggestions={false}
      />

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
            onClick={() => router.push("/audio-spaced")}
            className="w-full"
            variant="outline"
          >
            {t("flashcards.goToAudioFlashcard")}
          </Button>
        </CardContent>
      </Card>

      {/* Learning Deck Stats */}
      <Card>
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
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{cardStats.totalCards}</p>
                  <p className="text-xs text-muted-foreground">Total Cards</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {(cardStats.initialLearningDueNow || 0) + (cardStats.dueCount || 0)}
                  </p>
                  <p className="text-xs text-muted-foreground">Due Now</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{cardStats.reviewsToday}</p>
                  <p className="text-xs text-muted-foreground">Reviewed Today</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {cardStats.initialLearningCount > 0 ? cardStats.initialLearningCount : cardStats.newCount}
                  </p>
                  <p className="text-xs text-muted-foreground">New Cards</p>
                </div>
              </div>
              
              {/* Initial Learning Progress or Continue Learning Button */}
              {cardStats.initialLearningCount > 0 && (
                <div className="rounded-lg bg-cyan-50 dark:bg-cyan-950/30 border border-cyan-200 dark:border-cyan-800 p-4">
                  <p className="text-sm font-semibold text-cyan-900 dark:text-cyan-100 mb-2">
                    Learning Phase: {cardStats.initialLearningCount} cards
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
                  className="w-full"
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

      {/* Add Cards Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">➕ Add More Cards</CardTitle>
          <CardDescription>
            Import sentences to expand your learning deck
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label htmlFor="dataset" className="text-sm font-medium block mb-2">
              Select dataset:
            </label>
            {datasets.length > 0 ? (
              <select
                id="dataset"
                value={selectedDataset || ""}
                onChange={(e) => setSelectedDataset(e.target.value)}
                className="w-full px-3 py-2 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                {datasets.map((dataset) => (
                  <option key={dataset.id} value={dataset.name}>
                    {dataset.name}
                  </option>
                ))}
              </select>
            ) : (
              <div className="w-full px-3 py-2 border border-border rounded-md bg-background text-muted-foreground">
                Loading datasets...
              </div>
            )}
          </div>
          <div>
            <label htmlFor="cardCount" className="text-sm font-medium block mb-2">
              Number of cards to import:
            </label>
            <input
              id="cardCount"
              type="number"
              min="1"
              max="100"
              value={cardImportCount}
              onChange={(e) => setCardImportCount(Math.max(1, parseInt(e.target.value) || 10))}
              className="w-full px-3 py-2 border border-border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <Button
            onClick={async () => {
              if (!userId) return;
              try {
                setIsAddingCards(true);
                await requestCardImport({ 
                  userId, 
                  count: cardImportCount,
                  sourceLanguage: "en",
                  targetLanguage: userPreferences?.targetLanguage || "es",
                  dataset: selectedDataset,
                });
              } catch (error) {
                console.error("Error requesting card import:", error);
              } finally {
                setIsAddingCards(false);
              }
            }}
            disabled={isAddingCards}
            className="w-full"
          >
            {isAddingCards 
              ? "Requesting import..." 
              : (cardStats?.totalCards === 0 
                ? `🚀 Start Learning with ${cardImportCount} Sentences` 
                : `✨ Add ${cardImportCount} Sentences`)}
          </Button>
          
         
        </CardContent>
      </Card>

    </div>
  );
}
