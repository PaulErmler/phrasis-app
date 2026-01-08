import { 
  Headphones, 
  SlidersHorizontal, 
  MessageCircle, 
  Layers, 
  Brain, 
  Target 
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const featureConfig = [
  { key: "audioBased", icon: Headphones, color: "primary" },
  { key: "selfDriven", icon: SlidersHorizontal, color: "accent" },
  { key: "instantFeedback", icon: MessageCircle, color: "primary" },
  { key: "allInOne", icon: Layers, color: "accent" },
  { key: "spacedRepetition", icon: Brain, color: "primary" },
  { key: "languageIntelligence", icon: Target, color: "accent" },
] as const;

export function FeaturesSection() {
  const t = useTranslations('LandingPage.features');
  return (
    <section id="features" className="relative py-20 md:py-24 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-12 md:mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-6">
            {t('title')}{" "}
            <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>

        {/* Features grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {featureConfig.map((feature, index) => (
            <div
              key={feature.key}
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
                {t(`items.${feature.key}.title`)}
              </h3>
              <p className="text-muted-foreground leading-relaxed">
                {t(`items.${feature.key}.description`)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

