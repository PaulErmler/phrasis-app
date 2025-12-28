import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, Play } from "lucide-react";
import { FloatingSpeechBubble } from "./sound-wave";

interface HeroSectionProps {
  isAuthenticated: boolean;
}

export function HeroSection({ isAuthenticated }: HeroSectionProps) {
  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-4 py-20 md:py-32 overflow-hidden hero-gradient noise-bg">
      {/* Floating speech bubbles - language examples */}
      <FloatingSpeechBubble className="hidden md:block top-[15%] left-[8%]" delay={0}>
        <span className="text-primary">Hola</span> 
      </FloatingSpeechBubble>
      <FloatingSpeechBubble className="hidden md:block top-[8%] right-[10%]" delay={1.5}>
        <span className="text-primary">Bonjour</span> 
      </FloatingSpeechBubble>
      <FloatingSpeechBubble className="hidden lg:block bottom-[25%] right-[8%]" delay={2}>
        <span className="text-primary">こんにちは</span> 
      </FloatingSpeechBubble>


      <div className="relative z-10 w-full max-w-5xl mx-auto text-center space-y-8">
        {/* Logo */}
        <div className="inline-flex items-center justify-center w-46 h-46 md:w-46 md:h-46 animate-fade-in">
          <img
            src="/icons/icon.svg"
            alt="Phrasis Logo"
            className="w-full h-full"
            width={500}
            height={500}
          />
        </div>

        {/* Main Headline */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground animate-fade-in-up leading-[1.1]">
        <span className="gradient-text">Phrasis</span>
            {" "} - Master Languages{" "}
          <span className="gradient-text">While Living</span>{" "}
          Your Life
        </h1>

        {/* Subheadline */}
        <p className="text-lg md:text-xl lg:text-2xl text-muted-foreground max-w-3xl mx-auto animate-fade-in-up stagger-1 leading-relaxed">
          Audio flashcards that adapt to your level, AI that answers your questions instantly, 
          and spaced repetition that makes you remember up to 10x more — all while you commute, exercise, or cook.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 animate-fade-in-up stagger-3">
          {isAuthenticated ? (
            <Button
              asChild
              size="lg"
              className="w-full sm:w-auto min-w-[220px] text-lg h-14 shadow-xl shadow-primary/20 animate-pulse-glow"
            >
              <Link href="/app">
                Go to App
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </Button>
          ) : (
            <>
              <Button
                asChild
                size="lg"
                className="w-full sm:w-auto min-w-[220px] text-lg h-14 shadow-xl shadow-primary/20 animate-pulse-glow"
              >
                <Link href="/auth/sign-up">
                  Start Learning Free
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="w-full sm:w-auto min-w-[180px] text-lg h-14"
              >
                <a href="#features">
                  <Play className="mr-2 h-5 w-5" />
                  See How It Works
                </a>
              </Button>
            </>
          )}
        </div>

      </div>
    </section>
  );
}
