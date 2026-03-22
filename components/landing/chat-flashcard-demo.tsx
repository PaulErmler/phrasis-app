'use client';

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useLayoutEffect,
  useMemo,
  type RefObject,
} from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { motion, AnimatePresence } from 'motion/react';
import { Conversation, ConversationContent } from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { MessageResponse } from '@/components/ai-elements/message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getLanguageByCode } from '@/lib/languages';
import { useLandingDemo } from '@/components/landing/landing-demo-context';
import { MousePointer2 } from 'lucide-react';

type Scenario = 'grammar' | 'threeCards' | 'curiosity';

type Phase =
  | 'userTyping'
  | 'assistantTyping'
  | 'cardsVisible'
  | 'cursorMoving'
  | 'cursorPressing'
  | 'highlightApproved';

type ProposalLine = { code: string; text: string; romanization?: string };

type DemoCard = { lines: ProposalLine[] };

type MultiCardFields = { base: string; hi: string; hiRoman: string; es: string; fr: string };

function LangChip({ code }: { code: string }) {
  const lang = getLanguageByCode(code);
  return (
    <span className="font-medium text-muted-foreground uppercase text-xs">
      {lang?.code ?? code}
    </span>
  );
}

function readMultiCard(raw: unknown): MultiCardFields {
  const o = raw as Record<string, string>;
  return {
    base: o.base ?? '',
    hi: o.hi ?? '',
    hiRoman: o.hiRoman ?? '',
    es: o.es ?? '',
    fr: o.fr ?? '',
  };
}

function LandingChatScrollBinder({
  tick,
  rootRef,
}: {
  tick: number;
  rootRef: RefObject<HTMLDivElement | null>;
}) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const el = root.querySelector('[role="log"]');
    if (!el || !(el instanceof HTMLElement)) return;
    const t1 = window.setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 60);
    const t2 = window.setTimeout(() => {
      el.scrollTop = el.scrollHeight;
    }, 320);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [tick, rootRef]);
  return null;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const fn = () => setReduced(mq.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  return reduced;
}

function lineTextClass(code: string) {
  if (code === 'es' || code === 'fr') return 'text-base font-semibold';
  if (code === 'hi') return 'text-sm text-foreground';
  return 'text-sm text-muted-foreground';
}

function CourseProposalCard({
  lines,
  approved,
  approveLabel,
  rejectLabel,
  approvedLabel,
  approveTarget,
}: {
  lines: ProposalLine[];
  approved: boolean;
  approveLabel: string;
  rejectLabel: string;
  approvedLabel: string;
  approveTarget?: boolean;
}) {
  const cardInner = (
    <div className="space-y-1.5 text-sm">
      {lines.map((line, i) => (
        <div key={`${line.code}-${i}`} className="space-y-0.5">
          <p className={lineTextClass(line.code)}>
            <LangChip code={line.code} /> {line.text}
          </p>
          {line.romanization ? (
            <p className="ps-6 text-xs text-muted-foreground">{line.romanization}</p>
          ) : null}
        </div>
      ))}
    </div>
  );

  const shellClass = 'my-1 flex flex-col gap-2';

  if (approved) {
    return (
      <Alert
        className={`${shellClass} border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950`}
      >
        <AlertDescription className="p-0 m-0 [&_p]:mb-0">{cardInner}</AlertDescription>
        <div className="flex h-8 shrink-0 items-center justify-end gap-2">
          <p className="text-xs font-medium text-success">{approvedLabel}</p>
        </div>
      </Alert>
    );
  }

  return (
    <Alert className={`${shellClass}`}>
      <AlertDescription className="p-0 m-0 [&_p]:mb-0">{cardInner}</AlertDescription>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-sm" disabled>
          {rejectLabel}
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 px-3 text-sm"
          disabled
          {...(approveTarget ? { 'data-landing-approve-target': true } : {})}
        >
          {approveLabel}
        </Button>
      </div>
    </Alert>
  );
}

export function ChatFlashcardDemo() {
  const t = useTranslations('LandingPage.chatDemo');
  const locale = useLocale();
  const { multiCourse } = useLandingDemo();
  const reducedMotion = usePrefersReducedMotion();
  const [scenario, setScenario] = useState<Scenario>('grammar');
  const [runKey, setRunKey] = useState(0);
  const [phase, setPhase] = useState<Phase>('userTyping');
  const [userShown, setUserShown] = useState('');
  const [assistantShown, setAssistantShown] = useState('');
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cursorPath, setCursorPath] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const [revealedCardCount, setRevealedCardCount] = useState(0);
  const [pressPos, setPressPos] = useState<{ x: number; y: number } | null>(null);
  const cursorMoveAdvanceRef = useRef(false);
  const cursorPressAdvanceRef = useRef(false);

  const baseLangCode = locale.startsWith('de') ? 'de' : 'en';

  const { userFull, assistantFull, cards, highlightCardIndex } = useMemo(() => {
    const simpleLine = (base: string, target: string): ProposalLine[] => [
      { code: baseLangCode, text: base },
      { code: 'es', text: target },
    ];
    const multiLines = (m: MultiCardFields): ProposalLine[] => [
      { code: baseLangCode, text: m.base },
      { code: 'hi', text: m.hi, romanization: m.hiRoman },
      { code: 'es', text: m.es },
      { code: 'fr', text: m.fr },
    ];

    switch (scenario) {
      case 'grammar': {
        const user = t('grammar.userMessage');
        const assistant = t('grammar.assistantMessage');
        if (!multiCourse) {
          return {
            userFull: user,
            assistantFull: assistant,
            cards: [
              { lines: simpleLine(t('grammar.card1Base'), t('grammar.card1Target')) },
              { lines: simpleLine(t('grammar.card2Base'), t('grammar.card2Target')) },
            ] satisfies DemoCard[],
            highlightCardIndex: 1,
          };
        }
        const m1 = readMultiCard(t.raw('grammar.multiCard1'));
        const m2 = readMultiCard(t.raw('grammar.multiCard2'));
        return {
          userFull: user,
          assistantFull: assistant,
          cards: [{ lines: multiLines(m1) }, { lines: multiLines(m2) }],
          highlightCardIndex: 1,
        };
      }
      case 'threeCards': {
        const user = t('threeCards.userMessage');
        const assistant = multiCourse
          ? t('threeCards.assistantMessageMulti')
          : t('threeCards.assistantMessage');
        if (!multiCourse) {
          return {
            userFull: user,
            assistantFull: assistant,
            cards: [
              {
                lines: simpleLine(
                  t('threeCards.simple.card1Base'),
                  t('threeCards.simple.card1Target'),
                ),
              },
              {
                lines: simpleLine(
                  t('threeCards.simple.card2Base'),
                  t('threeCards.simple.card2Target'),
                ),
              },
              {
                lines: simpleLine(
                  t('threeCards.simple.card3Base'),
                  t('threeCards.simple.card3Target'),
                ),
              },
            ],
            highlightCardIndex: 2,
          };
        }
        const c1 = readMultiCard(t.raw('threeCards.multi.card1'));
        const c2 = readMultiCard(t.raw('threeCards.multi.card2'));
        const c3 = readMultiCard(t.raw('threeCards.multi.card3'));
        return {
          userFull: user,
          assistantFull: assistant,
          cards: [
            { lines: multiLines(c1) },
            { lines: multiLines(c2) },
            { lines: multiLines(c3) },
          ],
          highlightCardIndex: 2,
        };
      }
      case 'curiosity': {
        const user = t('curiosity.userMessage');
        const assistant = t('curiosity.assistantMessage');
        if (!multiCourse) {
          return {
            userFull: user,
            assistantFull: assistant,
            cards: [
              {
                lines: simpleLine(
                  t('curiosity.simple.card1Base'),
                  t('curiosity.simple.card1Target'),
                ),
              },
              {
                lines: simpleLine(
                  t('curiosity.simple.card2Base'),
                  t('curiosity.simple.card2Target'),
                ),
              },
            ],
            highlightCardIndex: 1,
          };
        }
        const c1 = readMultiCard(t.raw('curiosity.multi.card1'));
        const c2 = readMultiCard(t.raw('curiosity.multi.card2'));
        return {
          userFull: user,
          assistantFull: assistant,
          cards: [{ lines: multiLines(c1) }, { lines: multiLines(c2) }],
          highlightCardIndex: 1,
        };
      }
    }
  }, [scenario, t, multiCourse, baseLangCode]);

  const clearTimers = useCallback(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
  }, []);

  const after = useCallback((ms: number, fn: () => void) => {
    timeoutsRef.current.push(setTimeout(fn, ms));
  }, []);

  useEffect(() => {
    clearTimers();
    setPhase('userTyping');
    setUserShown('');
    setAssistantShown('');
    setCursorPath(null);
    setPressPos(null);
    cursorMoveAdvanceRef.current = false;
    cursorPressAdvanceRef.current = false;
    let cancelled = false;

    if (reducedMotion) {
      setUserShown(userFull);
      setAssistantShown(assistantFull);
      setPhase('cardsVisible');
      after(400, () => {
        if (!cancelled) setPhase('highlightApproved');
      });
      return () => {
        cancelled = true;
        clearTimers();
      };
    }

    const startAssistant = () => {
      if (cancelled) return;
      setPhase('assistantTyping');
      let j = 0;
      const stepAsst = () => {
        if (cancelled) return;
        j += 1;
        setAssistantShown(assistantFull.slice(0, j));
        if (j < assistantFull.length) {
          after(10, stepAsst);
        } else {
          after(280, () => {
            if (!cancelled) setPhase('cardsVisible');
          });
        }
      };
      stepAsst();
    };

    after(220, () => {
      if (cancelled) return;
      let i = 0;
      const stepUser = () => {
        if (cancelled) return;
        i += 1;
        setUserShown(userFull.slice(0, i));
        if (i < userFull.length) {
          after(18, stepUser);
        } else {
          after(260, startAssistant);
        }
      };
      stepUser();
    });

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [runKey, scenario, reducedMotion, userFull, assistantFull, after, clearTimers]);

  const showAssistantBubble =
    assistantShown.length > 0 || (reducedMotion && phase !== 'userTyping');

  const assistantComplete =
    reducedMotion || assistantShown.length === assistantFull.length;

  const showCards = assistantComplete && phase !== 'userTyping' && phase !== 'assistantTyping';

  useEffect(() => {
    if (!showCards) {
      setRevealedCardCount(0);
      return;
    }
    if (reducedMotion) {
      setRevealedCardCount(cards.length);
      return;
    }
    setRevealedCardCount(0);
    const staggerMs = 540;
    const leadMs = 400;
    const ids: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < cards.length; i++) {
      ids.push(
        setTimeout(() => {
          setRevealedCardCount(i + 1);
        }, leadMs + i * staggerMs),
      );
    }
    return () => ids.forEach(clearTimeout);
  }, [showCards, cards.length, runKey, scenario, reducedMotion]);

  useEffect(() => {
    if (phase !== 'cardsVisible' || reducedMotion || revealedCardCount < cards.length) return;
    const id = window.setTimeout(() => setPhase('cursorMoving'), 720);
    return () => clearTimeout(id);
  }, [phase, reducedMotion, revealedCardCount, cards.length]);

  useLayoutEffect(() => {
    if (phase !== 'cursorMoving') {
      if (phase !== 'cursorPressing') setCursorPath(null);
      return;
    }
    const wrap = wrapRef.current;
    const btn = wrap?.querySelector<HTMLElement>('[data-landing-approve-target]');
    if (!wrap || !btn) return;
    const wr = wrap.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    setCursorPath({
      from: { x: wr.width - 28, y: 36 },
      to: {
        x: br.left - wr.left + br.width / 2 - 6,
        y: br.top - wr.top + br.height / 2 - 4,
      },
    });
  }, [phase, cards, highlightCardIndex]);

  const prevMulti = useRef(multiCourse);
  useEffect(() => {
    if (prevMulti.current !== multiCourse) {
      clearTimers();
      setRunKey((k) => k + 1);
    }
    prevMulti.current = multiCourse;
  }, [multiCourse, clearTimers]);

  const highlightDone = phase === 'highlightApproved';

  useEffect(() => {
    if (!highlightDone) return;
    const id = window.setTimeout(() => {
      clearTimers();
      setRunKey((k) => k + 1);
    }, 6000);
    return () => clearTimeout(id);
  }, [highlightDone, clearTimers]);

  const scrollTick =
    userShown.length +
    assistantShown.length * 1000 +
    (showCards ? 50000 : 0) +
    revealedCardCount * 12000 +
    (phase === 'cursorMoving' ? 3000 : 0) +
    (phase === 'cursorPressing' ? 5000 : 0) +
    (highlightDone ? 100000 : 0) +
    (scenario === 'grammar' ? 1 : scenario === 'threeCards' ? 2 : 3) * 7 +
    (multiCourse ? 13 : 0) +
    cards.length * 3;

  return (
    <div className="flex w-full max-w-lg flex-col gap-3 mx-auto lg:mx-0">
      <Tabs
        value={scenario}
        onValueChange={(v) => {
          setScenario(v as Scenario);
          clearTimers();
          setRunKey((k) => k + 1);
        }}
        className="w-full"
      >
        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 p-1">
          <TabsTrigger value="grammar" className="px-2 py-2.5 text-xs sm:text-sm">
            {t('scenarioGrammar')}
          </TabsTrigger>
          <TabsTrigger value="threeCards" className="px-2 py-2.5 text-xs sm:text-sm">
            {t('scenarioCards')}
          </TabsTrigger>
          <TabsTrigger value="curiosity" className="px-2 py-2.5 text-xs sm:text-sm">
            {t('scenarioCuriosity')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex h-[min(24rem,62vh)] sm:h-[26rem] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/50">
        <div
          ref={wrapRef}
          className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden"
        >
          <Conversation className="h-full min-h-0 flex-1 overflow-y-hidden">
            <LandingChatScrollBinder tick={scrollTick} rootRef={wrapRef} />
            <ConversationContent className="gap-4 px-4 py-4">
              {userShown.length > 0 && (
                <Message from="user">
                  <MessageContent>
                    <MessageResponse>{userShown}</MessageResponse>
                  </MessageContent>
                </Message>
              )}

              {showAssistantBubble && (
                <Message from="assistant">
                  <MessageContent>
                    <MessageResponse>
                      {reducedMotion ? assistantFull : assistantShown}
                    </MessageResponse>
                  </MessageContent>
                </Message>
              )}

              {showCards && revealedCardCount > 0 && (
                <div className="space-y-3 pt-1">
                  {cards.slice(0, revealedCardCount).map((card, index) => (
                    <motion.div
                      key={`${runKey}-${scenario}-${index}`}
                      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.38, ease: [0.25, 0.1, 0.25, 1] }}
                    >
                      <CourseProposalCard
                        lines={card.lines}
                        approved={highlightDone && index === highlightCardIndex}
                        approveLabel={t('approve')}
                        rejectLabel={t('reject')}
                        approvedLabel={t('approved')}
                        approveTarget={index === highlightCardIndex}
                      />
                    </motion.div>
                  ))}
                </div>
              )}
            </ConversationContent>
          </Conversation>

          <AnimatePresence mode="wait">
            {phase === 'cursorMoving' && cursorPath && !reducedMotion && (
              <motion.div
                key="demo-cursor-move"
                className="pointer-events-none absolute left-0 top-0 z-30"
                initial={{
                  x: cursorPath.from.x,
                  y: cursorPath.from.y,
                  opacity: 0,
                  scale: 0.85,
                }}
                animate={{
                  x: cursorPath.to.x,
                  y: cursorPath.to.y,
                  opacity: 1,
                  scale: 1,
                }}
                exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.08 } }}
                transition={{ duration: 0.85, ease: [0.4, 0, 0.2, 1] }}
                onAnimationComplete={() => {
                  if (cursorMoveAdvanceRef.current || !cursorPath) return;
                  cursorMoveAdvanceRef.current = true;
                  setPressPos({ x: cursorPath.to.x, y: cursorPath.to.y });
                  setPhase('cursorPressing');
                }}
              >
                <MousePointer2 className="h-9 w-9 fill-primary text-primary drop-shadow-lg" />
              </motion.div>
            )}
            {phase === 'cursorPressing' && pressPos && !reducedMotion && (
              <motion.div
                key="demo-cursor-press"
                className="pointer-events-none absolute left-0 top-0 z-30"
                initial={{
                  x: pressPos.x,
                  y: pressPos.y,
                  opacity: 1,
                  scale: 1,
                }}
                animate={{
                  opacity: 0,
                  scale: 0.86,
                }}
                transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                onAnimationComplete={() => {
                  if (cursorPressAdvanceRef.current) return;
                  cursorPressAdvanceRef.current = true;
                  setPhase('highlightApproved');
                }}
              >
                <MousePointer2 className="h-9 w-9 fill-primary text-primary drop-shadow-lg" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
