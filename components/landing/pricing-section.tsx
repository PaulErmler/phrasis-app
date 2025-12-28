import Link from "next/link";
import { Check, X, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const traditionalIssues = [
  "Limited hours per course",
  "Fixed schedule and location",
  "No individualised content",
  "No long-term review strategy",
];

const pricingPlans = [
  {
    name: "Free",
    description: "Perfect for getting started",
    price: "€0",
    period: "forever",
    features: [
      "200 reviews per month",
      "10 custom flashcards per month",
      "1 language",
      "5 AI Questions per month",
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Basic",
    description: "For dedicated learners",
    price: "€9",
    period: "per month",
    features: [
        "2000 reviews per month",
        "50 custom flashcards per month",
        "Up to 2 languages",
        "100 AI Questions per month",
    ],
    cta: "Start Free Trial",
    highlighted: true,
  },
  {
    name: "Pro",
    description: "Maximum learning power",
    price: "€19",
    period: "per month",
    features: [
        "Unlimited reviews per month",
        "500 custom flashcards per month",
        "Unlimited languages",
        "500 AI Questions per month",
        "Priority Access to new features",
    ],
    cta: "Start Free Trial",
    highlighted: false,
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="relative py-20 md:py-24 px-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-6">
            Simple, Transparent{" "}
            <span className="gradient-text">Pricing</span>
          </h2>

        </div>

        {/* Pricing cards - CSS scroll-snap carousel */}
        <div className="max-w-6xl mx-auto px-4 md:px-12">
          <div className="pricing-carousel flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4 md:overflow-visible md:grid md:grid-cols-3 md:gap-6 py-12">
            {pricingPlans.map((plan, index) => (
              <div
                key={plan.name}
                className="snap-start shrink-0 w-[85%] sm:w-[70%] md:w-auto"
              >
                {/* Main Card Container */}
                <div
                  className={cn(
                    "pricing-card group relative flex flex-col p-8 rounded-2xl h-full isolation-isolate",
                    "opacity-0 animate-fade-in-up",
                    "bg-card border",
                    plan.highlighted ? "border-primary/50" : "border-border/50"
                  )}
                  style={{
                    animationDelay: `${index * 0.1}s`,
                    animationFillMode: "forwards",
                  }}
                >
                  {/* Plan header */}
                  <div className="mb-6">
                    <h3 className="text-xl font-semibold mb-2">{plan.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {plan.description}
                    </p>
                  </div>

                  {/* Price */}
                  <div className="mb-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl md:text-5xl font-bold">
                        {plan.price}
                      </span>
                      <span className="text-muted-foreground">/{plan.period}</span>
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="flex-1 space-y-3 mb-8">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <div
                          className={cn(
                            "flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5",
                            plan.highlighted ? "bg-primary/20" : "bg-muted"
                          )}
                        >
                          <Check
                            className={cn(
                              "w-3 h-3",
                              plan.highlighted ? "text-primary" : "text-foreground"
                            )}
                          />
                        </div>
                        <span className="text-sm">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA button */}
                  <Button
                    asChild
                    variant={plan.highlighted ? "default" : "outline"}
                    size="lg"
                    className={cn(
                      "w-full",
                      plan.highlighted && "shadow-none" 
                    )}
                  >
                    <Link href="/auth/sign-up">
                      {plan.cta}
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Comparison header - Traditional courses context */}
        <div className="mb-12 md:mb-16 py-10">
          <div className="bg-muted/30 rounded-2xl border border-border/50 p-6 md:p-10 max-w-5xl mx-auto">
            <div className="grid md:grid-cols-2 gap-8 md:gap-10 lg:gap-12">
              {/* Left side - Traditional Courses header and price */}
              <div className="space-y-4 md:space-y-5 text-center md:text-left md:pr-4">
                <div>
                  <h2 className="text-xl md:text-2xl lg:text-2xl font-bold text-muted-foreground">
                    Compared with:
                  </h2>
                </div>
                <div className="flex flex-col md:flex-row items-center md:items-center gap-2 md:gap-3">
                 <h3 className="text-2xl md:text-2xl lg:text-3xl font-bold text-muted-foreground">
                    Traditional Courses
                  </h3>
                </div>
                
                <div className="pt-2 md:pt-4">
                  <div className="flex flex-col md:flex-row items-center md:items-baseline gap-1 md:gap-2">
                    <span className="text-3xl md:text-3xl lg:text-4xl font-bold text-muted-foreground">
                      €299 - €599
                    </span>
                    <span className="text-muted-foreground/70 text-sm md:text-base">
                      /8 weeks
                    </span>
                  </div>
                </div>
              </div>

              {/* Right side - Issues list */}
              <div className="space-y-4 md:space-y-5 md:pl-4 md:border-l md:border-border/30">
                <h4 className="text-lg md:text-xl font-semibold text-muted-foreground text-center md:text-left">
                  What you get:
                </h4>
                
                <div className="space-y-3 md:space-y-3.5">
                  {traditionalIssues.map((issue) => (
                    <div
                      key={issue}
                      className="flex items-start gap-2.5 md:gap-3"
                    >
                      <div className="flex-shrink-0 w-5 h-5 md:w-6 md:h-6 rounded-full bg-muted flex items-center justify-center mt-0.5">
                        <X className="w-3 h-3 md:w-3.5 md:h-3.5 text-muted-foreground/60" />
                      </div>
                      <span className="text-muted-foreground leading-relaxed text-sm md:text-base">
                        {issue}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
        
      </div>
    </section>
  );
}
