"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { SignedIn, SignedOut, UserButton } from "@daveyplate/better-auth-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";
import { Footer } from "@/components/Footer";
import { ArrowLeft, MessageSquare } from "lucide-react";

export default function ChatPage() {
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
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/app")}
              className="mr-2"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="w-8 h-8 rounded-lg bg-linear-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
              <span className="text-sm font-bold text-white">P</span>
            </div>
            <span className="font-semibold text-lg">Phrasis</span>
          </div>
          <div className="flex items-center gap-4">
            <SignedIn>
              <UserButton size="icon" />
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
          <div className="max-w-xl mx-auto space-y-6">
            <div className="text-center space-y-2">
              <h1 className="text-2xl font-bold">Chat</h1>
              <p className="text-muted-foreground">
                Start a conversation or practice your language skills
              </p>
            </div>

            <Card className="border-border/50 shadow-lg">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <MessageSquare className="h-5 w-5 text-emerald-500" />
                  Chat Interface
                </CardTitle>
                <CardDescription>
                  Your chat interface will appear here
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-xl bg-muted/50 border border-border/50 p-8 text-center">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="text-muted-foreground">
                    Chat functionality coming soon...
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
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

