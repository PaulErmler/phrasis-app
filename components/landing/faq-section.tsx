import { ChevronDown } from "lucide-react";
import { PWAInstallButton } from "./pwa-install-button";
import { CTAButtons } from "../home/cta-buttons";

const faqs = [
  {
    question: "What is Phrasis?",
    answer: [
      "Phrasis is an audio-first language learning app. Unlike traditional apps, you can learn hands-free while commuting, exercising, or doing chores. It reads out sentences in one language and then you have some time to come up with the translation before the app tells you the correct answer and moves on to the next sentence.",
      "If you don't understand something, you can ask a state of the art language model to explain it to you. You can also let it create new flashcards for you.",
    ],
  },
  {
    question: "Is Phrasis free?",
    answer: [
      "Phrasis offers a free tier such that you can try it. Unfortunately, we cannot offer it completely free as we have to cover our running costs. If you need higher limits you can upgrade to our Basic or Pro plans.",
    ],
  },
  {
    question: "How does Phrasis work?",
    answer: [
      "Phrasis uses audio flashcards that play phrases in your target language, followed by the translation. You can rate how well you knew each phrase, and our spaced repetition algorithm shows the card again when you are likely about to forget it. ", 
      "If you dont understand a phrase you can ask the AI tutor questions anytime — like 'How can I say this more politely?' or 'Give me 3 more examples with this verb in a different tense.' We generate natural-sounding audio using state of the art text-to-speech technology.",
    ],
  },
  {
    question: "Can I add my own phrases?",
    answer: [
      "Absolutely! You can either upload images, PDF, CSV or text files and Phrasis will automatically create flashcards for you. You can also add your own flashcards manually.",
      "Are we missing a method that you would like to use? Let us know and we will try to add it."
    ],
  },
  {
    question: "How long does it take to get fluent?",
    answer: [
      "Fluency depends on many factors: the language, your native language, daily practice time, and learning methods.",
      "The goal of Phrasis is to give you all the tools you need to learn it as fast as possible. For instance Phrasis teaches you new words in the order they appear most commonly. This way you can become fluent faster in more contexts because you learn the most frequent words first."
    ],
  },
  {
    question: "What languages does Phrasis support?",
    answer: [
      "Currently, Phrasis supports learning Spanish, French, German, Italian, Portuguese, and Japanese, with more languages being added regularly.", 
      "Is your langauge not supported? Let us know and we will try to prioritize it."
    ],
  },
  {
    question: "Why is Phrasis a subscription?",
    answer: [
      "Running AI models for voice generation and intelligent tutoring has ongoing costs. You can try it for free and see if it works for you.", 
      "Phrasis can save you a lot of time e.g. because you can learn while on the go and it makes learning new sentences and vocabulary way easier."
    ],
  },
  {
    question: "Can I download Phrasis as an app?",
    answer: [
      "You can install Phrasis as a Web App right now! This gives you an app-like experience and home screen access. We're also working on native iOS and Android apps that will be available in the app stores soon.",
    ],
    hasInstallButton: true,
  },
];

export function FAQSection() {
  return (
    <section id="faq" className="relative py-20 md:py-24 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-6">
            Frequently Asked{" "}
            <span className="gradient-text">Questions</span>
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground">
            Everything you need to know about Phrasis
          </p>
        </div>

        {/* FAQ Accordion using native details/summary */}
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <details
              key={index}
              className="faq-details group border border-border/50 rounded-xl px-6 bg-card/50 backdrop-blur-sm open:bg-card"
            >
              <summary className="flex items-center justify-between cursor-pointer text-left text-base md:text-lg font-medium py-5 list-none [&::-webkit-details-marker]:hidden">
                {faq.question}
                <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0 ml-4 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="text-muted-foreground pb-5 leading-relaxed">
                <div className="space-y-3">
                  {faq.answer.map((paragraph, pIndex) => (
                    <p key={pIndex}>{paragraph}</p>
                  ))}
                </div>
                {faq.hasInstallButton && (
                  <div className="mt-4">
                    <PWAInstallButton />
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>

        {/* Still have questions */}
        <div className="text-center mt-12 p-8 rounded-2xl bg-muted/50 border border-border/30">
          <p className="text-lg font-medium mb-2">Still have questions?</p>
          <p className="text-muted-foreground">
            Reach out to us at{" "}
            <a 
              href="mailto:support@phrasis.app" 
              className="text-primary hover:underline"
            >
              support@phrasis.app
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
