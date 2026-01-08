"use client"; // Add this!

import { SimplifiedChatView } from "@/components/app/SimplifiedChatView";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { RedirectToSignIn } from "@daveyplate/better-auth-ui";
import { Authenticated } from "convex/react";
import { use } from "react"; // Use 'use' to unwrap params in client components

export default function ChatPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  // In Next.js 15 Client Components, we unwrap params using React.use()
  const { threadId } = use(params);

  return (
    <>
      <RedirectToSignIn />
      <Authenticated>
      <div className="flex flex-col h-screen overflow-hidden">
          <header className="border-b bg-background">
            <div className="container mx-auto px-4 h-14 flex items-center justify-between">
              <Link href="/app">
                <Button variant="ghost" className="gap-2 -ml-2">
                  <ChevronLeft className="h-4 w-4" />
                  Back
                </Button>
              </Link>
              <ThemeSwitcher />
            </div>
          </header>

          <main className="flex-1 min-h-0 relative">
            <SimplifiedChatView threadId={threadId} />
          </main>

        </div>
      </Authenticated>
    </>
  );
}