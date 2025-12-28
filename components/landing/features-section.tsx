import { 
  Headphones, 
  SlidersHorizontal, 
  MessageCircle, 
  Layers, 
  Brain, 
  Target 
} from "lucide-react";
import { cn } from "@/lib/utils";

const features = [
  {
    icon: Headphones,
    title: "Audio Based",
    description: "Learn while commuting, exercising, or cooking. No screen required — just listen, repeat, and absorb.",
    color: "primary",
  },
  {
    icon: SlidersHorizontal,
    title: "Self Driven",
    description: "Add your own phrases from images or files. Ask Phrasis to create sentences for you. Or use our smart defaults tailored to your level.",
    color: "accent",
  },
  {
    icon: MessageCircle,
    title: "Instant Feedback",
    description: "Ask any vocabulary or grammar question anytime. Our AI tutor explains nuances, alternatives, and usage and creates flashcards and notes for you.",
    color: "primary",
  },
  {
    icon: Layers,
    title: "All-in-One",
    description: "No more switching between dictionaries, ChatGPT, and flashcard apps. Instead spend your time learning. Everything you need in one place. ",
    color: "accent",
  },
  {
    icon: Brain,
    title: "Spaced Repetition",
    description: "Remember up to 10x more with scientifically-proven algorithms that show you cards exactly when you need them.",
    color: "primary",
  },
  {
    icon: Target,
    title: "Language Intelligence",
    description: "Learn the most commonly used words and phrases first, or focus on vocabulary for your specific goals and interests.",
    color: "accent",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="relative py-20 md:py-24 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-12 md:mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-6">
            Everything You Need to{" "}
            <span className="gradient-text">Learn Faster</span>
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground">
            Phrasis combines the best of audio learning, AI tutoring, and memory science 
            into one seamless experience that fits your busy life.
          </p>
        </div>

        {/* Features grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {features.map((feature, index) => (
            <div
              key={feature.title}
              className={cn(
                "feature-card group relative p-8 rounded-2xl border border-border/50",
                "bg-card/50 backdrop-blur-sm",
                "opacity-0 animate-fade-in-up"
              )}
              style={{ animationDelay: `${index * 0.1}s`, animationFillMode: "forwards" }}
            >
              {/* Icon with logo-style stacked squares */}
              <div className="relative w-16 h-16 mb-6">
                {/* Background square (orange accent) */}
                <div 
                  className={cn(
                    "absolute top-2 left-2 w-14 h-14 rounded-[14px]",
                    feature.color === "accent" ? "bg-[#FFB300]" : "bg-primary/30"
                  )}
                />
                {/* Foreground square (primary blue) */}
                <div 
                  className={cn(
                    "absolute top-0 left-0 w-14 h-14 rounded-[14px] flex items-center justify-center shadow-lg",
                    feature.color === "accent" ? "bg-primary" : "bg-primary"
                  )}
                >
                  <feature.icon className="w-7 h-7 text-white" />
                </div>
              </div>

              {/* Content */}
              <h3 className="text-xl font-semibold mb-3 group-hover:text-primary transition-colors">
                {feature.title}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

