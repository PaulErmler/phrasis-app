"use client";

import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Bell, BellOff, BellRing } from "lucide-react";

export function NotificationTest() {
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
      new Notification("Phrasis", {
        body: "Time to practice your phrases! 🌟",
        icon: "/icons/icon-192x192.png",
        tag: "phrasis-reminder",
      });
    }
  }, [notificationPermission, requestNotificationPermission]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <BellRing className="h-5 w-5" />
          Notifications Test
        </CardTitle>
        <CardDescription>
          Test push notification functionality
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {notificationPermission === "unsupported" ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <BellOff className="h-4 w-4" />
            <span className="text-sm">Notifications not available in this browser</span>
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
            className="w-full"
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
          <p className="text-muted-xs text-center">
            ✓ Notifications enabled
          </p>
        )}
      </CardContent>
    </Card>
  );
}

