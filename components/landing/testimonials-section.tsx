"use client";

import { Quote } from "lucide-react";
import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";

export function TestimonialsSection() {
  const t = useTranslations('LandingPage.testimonials');
  
  // Get testimonials from translations
  const testimonials = Array.from({ length: 6 }, (_, i) => ({
    quote: t(`items.${i}.quote`),
    author: t(`items.${i}.author`),
    role: t(`items.${i}.role`),
  }));
  const [api, setApi] = useState<CarouselApi>();
  const [current, setCurrent] = useState(0);
  const [isHovered, setIsHovered] = useState(false);

  // Track current slide
  useEffect(() => {
    if (!api) return;

    setCurrent(api.selectedScrollSnap());

    api.on("select", () => {
      setCurrent(api.selectedScrollSnap());
    });
  }, [api]);

  // Auto-advance timer
  useEffect(() => {
    if (!api || isHovered) return;

    const timer = setInterval(() => {
      api.scrollNext();
    }, 5000);

    return () => clearInterval(timer);
  }, [api, isHovered]);

  return (
    <section id="testimonials" className="relative py-16 md:py-20 px-4 bg-muted/30 overflow-hidden">
      <div className="relative z-10 max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold">
            {t('title')} <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
        </div>

        {/* Carousel container */}
        <div
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <Carousel
            setApi={setApi}
            opts={{
              align: "start",
              loop: true,
            }}
            className="w-full"
          >
            <CarouselContent className="-ml-3">
              {testimonials.map((testimonial, index) => (
                <CarouselItem
                  key={index}
                  className="pl-3 md:basis-1/2 lg:basis-1/3"
                >
                  <div className="bg-card rounded-2xl border border-border/50 p-6 md:p-8 h-full flex flex-col">
                    {/* Quote icon */}
                    <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-primary/10 mb-4">
                      <Quote className="w-5 h-5 text-primary" />
                    </div>

                    {/* Quote text */}
                    <blockquote className="text-base md:text-lg text-foreground mb-6 leading-relaxed flex-1">
                      "{testimonial.quote}"
                    </blockquote>

                    {/* Author */}
                    <div>
                      <p className="font-semibold text-foreground">{testimonial.author}</p>
                      <p className="text-sm text-muted-foreground">{testimonial.role}</p>
                    </div>
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
          </Carousel>
        </div>

        {/* Dot indicators */}
        <div className="flex justify-center gap-2 mt-8">
          {testimonials.map((_, index) => (
            <button
              key={index}
              onClick={() => api?.scrollTo(index)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === current
                  ? "bg-primary w-8"
                  : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
              }`}
              aria-label={`Go to testimonial ${index + 1}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
