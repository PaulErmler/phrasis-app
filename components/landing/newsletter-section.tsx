"use client";

import { useState } from "react";
import { Mail, ArrowRight, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function NewsletterSection() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setStatus("loading");
    
    // Simulate API call - replace with actual newsletter signup
    await new Promise((resolve) => setTimeout(resolve, 1000));
    
    setStatus("success");
    setEmail("");
    
    // Reset after 3 seconds
    setTimeout(() => setStatus("idle"), 3000);
  };

  return (
    <section className="relative py-20 md:py-24 px-4 newsletter-gradient noise-bg overflow-hidden">
      <div className="relative z-10 max-w-4xl mx-auto">
        <div className="rounded-3xl bg-card border border-border/50 p-8 md:p-12 lg:p-16 shadow-xl">
          <div className="flex flex-col lg:flex-row items-center gap-8 lg:gap-12">
            {/* Left side - Content */}
            <div className="flex-1 text-center lg:text-left">
              <h2 className="text-2xl md:text-3xl lg:text-4xl font-bold tracking-tight mb-4">
                Get Language Tips & Updates
              </h2>
              <p className="text-muted-foreground text-lg">
                Join our newsletter for exclusive learning strategies, new feature announcements, 
                and tips from polyglots. Unsubscribe anytime.
              </p>
            </div>

            {/* Right side - Form */}
            <div className="w-full lg:w-auto lg:min-w-[320px]">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="relative">
                  <Input
                    type="email"
                    placeholder="Enter your email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={status === "loading" || status === "success"}
                    className={cn(
                      "h-14 px-5 text-base pr-[140px]",
                      status === "success" && "border-green-500"
                    )}
                    required
                  />
                  <Button
                    type="submit"
                    disabled={status === "loading" || status === "success" || !email}
                    className={cn(
                      "absolute right-2 top-1/2 -translate-y-1/2 h-10",
                      status === "success" && "bg-green-500 hover:bg-green-500"
                    )}
                  >
                    {status === "loading" ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : status === "success" ? (
                      <>
                        <Check className="w-4 h-4" />
                        Done
                      </>
                    ) : (
                      <>
                        Subscribe
                        <ArrowRight className="w-4 h-4 ml-1" />
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground text-center lg:text-left">
                  We respect your privacy. No spam, ever.
                </p>
              </form>

              {status === "success" && (
                <div className="mt-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-sm text-center">
                  You're subscribed! Check your inbox for a welcome email.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

