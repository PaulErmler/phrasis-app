"use client";

import { Quote } from "lucide-react";
import { useState, useEffect } from "react";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";

const testimonials = [
  {
    quote: "Phrasis completely changed how I learn languages. I can finally make progress during my daily commute!",
    author: "Sarah M.",
    role: "Learning Spanish",
  },
  {
    quote: "The AI answers my grammar questions instantly. It's like having a personal tutor available 24/7. Whenever I have a question, I can ask and Phrasis automatically creates a flashcard for me so that I dont forget the answer.",
    author: "Michael T.",
    role: "Learning French",
  },
  {
    quote: "I love that I can add my own phrases from books I'm reading. Finally, a language app that adapts to me!",
    author: "Anna K.",
    role: "Learning German",
  },
  {
    quote: "The spaced repetition actually works. I'm remembering vocabulary so much better than with other apps.",
    author: "David L.",
    role: "Learning Japanese",
  },
  {
    quote: "Being able to learn hands-free while cooking or exercising is a game-changer for me!",
    author: "Emma R.",
    role: "Learning Italian",
  },
  {
    quote: "Instead of having to sit at my desk for hours to learn Portuguese, I go on walks and can spend time outside while learning.",
    author: "Lisa P.",
    role: "Learning Portuguese",
  },
];

export function TestimonialsSection() {
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
            Loved by <span className="gradient-text">Language Learners</span>
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
