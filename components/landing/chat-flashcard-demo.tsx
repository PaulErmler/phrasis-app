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
import {
  Conversation,
  ConversationContent,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { MessageResponse } from '@/components/ai-elements/message';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LandingAudioButton } from '@/components/landing/LandingAudioButton';
import { getLandingAudioUrl } from '@/lib/landing/audio';
import { getLanguageShortLabel } from '@/lib/languages';
import { useLandingDemo } from '@/components/landing/landing-demo-context';
import { MousePointer2, Pencil, RotateCcw } from 'lucide-react';

type Scenario = 'grammar' | 'simpler' | 'restaurant';

type Phase =
  | 'userTyping'
  | 'streaming'
  | 'cursorMoving'
  | 'cursorPressing'
  | 'done';

type ProposalLine = { code: string; text: string };

type DemoPart =
  | { type: 'text'; text: string }
  | { type: 'card'; lines: ProposalLine[] };

/** Raw i18n shape of one conversation part (scenarios.*.simple / .multi). */
type RawPart = {
  text?: string;
  card?: { base?: string; es?: string; fr?: string };
};

function LangChip({ code }: { code: string }) {
  return (
    <span className="font-medium text-muted-foreground uppercase text-xs">
      {getLanguageShortLabel(code)}
    </span>
  );
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
    // Follow the stream only while the viewer is near the bottom. Once they
    // scroll up to re-read, stop yanking the log down (like a real chat). The
    // threshold must absorb the height jump of a card revealing all at once,
    // or the follow silently stops mid-conversation.
    const nearBottom = () =>
      el.scrollHeight - el.scrollTop - el.clientHeight < 400;
    if (!nearBottom()) return;
    const t1 = window.setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }, 60);
    const t2 = window.setTimeout(() => {
      if (nearBottom()) el.scrollTop = el.scrollHeight;
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

/** Base lines muted, target lines bold, same hierarchy as the in-app CardApproval. */
function lineTextClass(code: string) {
  if (code === 'es' || code === 'fr') return 'text-base font-semibold';
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
        <div key={`${line.code}-${i}`} className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className={lineTextClass(line.code)}>
              <LangChip code={line.code} /> {line.text}
            </p>
          </div>
          <LandingAudioButton
            url={getLandingAudioUrl(line.text, line.code)}
            language={getLanguageShortLabel(line.code)}
          />
        </div>
      ))}
    </div>
  );

  if (approved) {
    return (
      <Alert className="my-3 flex flex-col gap-3 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
        <AlertDescription className="p-0 m-0 [&_p]:mb-0">
          {cardInner}
        </AlertDescription>
        <div className="flex h-8 w-full items-center gap-2">
          <Button
            disabled
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-xs font-medium text-success hover:bg-transparent disabled:opacity-100"
          >
            {approvedLabel}
          </Button>
        </div>
      </Alert>
    );
  }

  return (
    <Alert className="my-3 flex flex-col gap-3">
      <AlertDescription className="p-0 m-0 [&_p]:mb-0">
        {cardInner}
      </AlertDescription>
      <div className="flex h-8 w-full items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 px-3 text-sm"
          disabled
        >
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
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="ml-auto h-8 w-8"
          disabled
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </div>
    </Alert>
  );
}

/**
 * The card "currently being reviewed". Shown in the section's text column so
 * visitors see the context the tutor already knows about. Same card as the
 * review-modes demo, so the whole landing page tells one story.
 */
export function ChatDemoContextCard() {
  const t = useTranslations('LandingPage.chatDemo');
  const locale = useLocale();
  const { multiCourse } = useLandingDemo();
  const baseLangCode = locale.startsWith('de') ? 'de' : 'en';
  const base = t('contextCard.base');
  const targets: ProposalLine[] = [
    { code: 'es', text: t('contextCard.es') },
    ...(multiCourse ? [{ code: 'fr', text: t('contextCard.fr') }] : []),
  ];

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 shadow-sm space-y-3">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-base font-medium">{base}</p>
        <LandingAudioButton
          url={getLandingAudioUrl(base, baseLangCode)}
          language={getLanguageShortLabel(baseLangCode)}
        />
      </div>
      <Separator />
      <div className="space-y-1.5">
        {targets.map((line) => (
          <div key={line.code} className="flex items-start gap-2">
            <p className="flex-1 text-base font-semibold">{line.text}</p>
            <LandingAudioButton
              url={getLandingAudioUrl(line.text, line.code)}
              language={getLanguageShortLabel(line.code)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const USER_TYPE_MS = 18;
const ASSISTANT_TYPE_MS = 6;

export function ChatFlashcardDemo() {
  const t = useTranslations('LandingPage.chatDemo');
  const locale = useLocale();
  const baseLangCode = locale.startsWith('de') ? 'de' : 'en';
  const { multiCourse } = useLandingDemo();
  const reducedMotion = usePrefersReducedMotion();
  const [scenario, setScenario] = useState<Scenario>('grammar');
  const [runKey, setRunKey] = useState(0);
  const [phase, setPhase] = useState<Phase>('userTyping');
  const [userShown, setUserShown] = useState('');
  const [donePartCount, setDonePartCount] = useState(0);
  const [streamText, setStreamText] = useState('');
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cursorPath, setCursorPath] = useState<{
    from: { x: number; y: number };
    to: { x: number; y: number };
  } | null>(null);
  const [pressPos, setPressPos] = useState<{ x: number; y: number } | null>(
    null,
  );
  const cursorMoveAdvanceRef = useRef(false);
  const cursorPressAdvanceRef = useRef(false);
  // Scenarios whose animation already ran to completion: revisiting their tab
  // shows the finished conversation instead of replaying it.
  const completedRef = useRef<Set<Scenario>>(new Set());

  const { userFull, parts, highlightCardIndex } = useMemo(() => {
    const userFull = t(`scenarios.${scenario}.userMessage`);
    const raw = t.raw(
      `scenarios.${scenario}.${multiCourse ? 'multi' : 'simple'}`,
    ) as RawPart[];
    const parts: DemoPart[] = raw.map((p) => {
      if (typeof p.text === 'string') return { type: 'text', text: p.text };
      const card = p.card ?? {};
      const lines: ProposalLine[] = [
        { code: baseLangCode, text: card.base ?? '' },
        ...(card.es ? [{ code: 'es', text: card.es }] : []),
        ...(multiCourse && card.fr ? [{ code: 'fr', text: card.fr }] : []),
      ];
      return { type: 'card', lines };
    });
    // The fake cursor approves the conversation's last proposed card.
    let highlightCardIndex = -1;
    parts.forEach((p, i) => {
      if (p.type === 'card') highlightCardIndex = i;
    });
    return { userFull, parts, highlightCardIndex };
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
    setDonePartCount(0);
    setStreamText('');
    setCursorPath(null);
    setPressPos(null);
    cursorMoveAdvanceRef.current = false;
    cursorPressAdvanceRef.current = false;
    let cancelled = false;

    if (reducedMotion || completedRef.current.has(scenario)) {
      setUserShown(userFull);
      setDonePartCount(parts.length);
      setPhase('done');
      return () => {
        cancelled = true;
        clearTimers();
      };
    }

    const startCursor = () => {
      if (cancelled) return;
      if (highlightCardIndex === -1) {
        setPhase('done');
        return;
      }
      setPhase('cursorMoving');
    };

    const processPart = (index: number) => {
      if (cancelled) return;
      if (index >= parts.length) {
        after(650, startCursor);
        return;
      }
      const part = parts[index];
      if (part.type === 'card') {
        setDonePartCount(index + 1);
        after(550, () => processPart(index + 1));
        return;
      }
      let j = 0;
      const step = () => {
        if (cancelled) return;
        j += 1;
        setStreamText(part.text.slice(0, j));
        if (j < part.text.length) {
          after(ASSISTANT_TYPE_MS, step);
        } else {
          after(350, () => {
            if (cancelled) return;
            setDonePartCount(index + 1);
            setStreamText('');
            processPart(index + 1);
          });
        }
      };
      step();
    };

    after(220, () => {
      if (cancelled) return;
      let i = 0;
      const stepUser = () => {
        if (cancelled) return;
        i += 1;
        setUserShown(userFull.slice(0, i));
        if (i < userFull.length) {
          after(USER_TYPE_MS, stepUser);
        } else {
          after(280, () => {
            if (cancelled) return;
            setPhase('streaming');
            processPart(0);
          });
        }
      };
      stepUser();
    });

    return () => {
      cancelled = true;
      clearTimers();
    };
  }, [
    runKey,
    scenario,
    reducedMotion,
    userFull,
    parts,
    highlightCardIndex,
    after,
    clearTimers,
  ]);

  useLayoutEffect(() => {
    if (phase !== 'cursorMoving') {
      if (phase !== 'cursorPressing') setCursorPath(null);
      return;
    }
    const wrap = wrapRef.current;
    const btn = wrap?.querySelector<HTMLElement>(
      '[data-landing-approve-target]',
    );
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
  }, [phase, parts, highlightCardIndex]);

  const prevMulti = useRef(multiCourse);
  useEffect(() => {
    if (prevMulti.current !== multiCourse) {
      // The toggle swaps the conversation content, so finished runs no
      // longer apply. Replay everything from scratch.
      completedRef.current.clear();
      clearTimers();
      setRunKey((k) => k + 1);
    }
    prevMulti.current = multiCourse;
  }, [multiCourse, clearTimers]);

  const done = phase === 'done';

  useEffect(() => {
    if (done) completedRef.current.add(scenario);
  }, [done, scenario]);

  const replay = () => {
    completedRef.current.delete(scenario);
    clearTimers();
    setRunKey((k) => k + 1);
  };

  const streamingPart =
    phase === 'streaming' && donePartCount < parts.length
      ? parts[donePartCount]
      : null;

  // No tick for the cursor phases: the view is already at the bottom when the
  // cursor starts, and scrolling after the pointer path is measured would
  // move the approve button out from under it.
  const scrollTick =
    userShown.length +
    streamText.length +
    donePartCount * 5000 +
    (done ? 200000 : 0);

  const renderCard = (
    part: Extract<DemoPart, { type: 'card' }>,
    index: number,
  ) => (
    <motion.div
      key={`${runKey}-${scenario}-card-${index}`}
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: [0.25, 0.1, 0.25, 1] }}
    >
      <CourseProposalCard
        lines={part.lines}
        approved={done && index === highlightCardIndex}
        approveLabel={t('approve')}
        rejectLabel={t('reject')}
        approvedLabel={t('approved')}
        approveTarget={index === highlightCardIndex}
      />
    </motion.div>
  );

  const showAssistant = donePartCount > 0 || streamingPart !== null;

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
          <TabsTrigger
            value="grammar"
            className="px-2 py-2.5 text-xs sm:text-sm"
          >
            {t('scenarioGrammar')}
          </TabsTrigger>
          <TabsTrigger
            value="simpler"
            className="px-2 py-2.5 text-xs sm:text-sm"
          >
            {t('scenarioSimpler')}
          </TabsTrigger>
          <TabsTrigger
            value="restaurant"
            className="px-2 py-2.5 text-xs sm:text-sm"
          >
            {t('scenarioCards')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex h-[min(28rem,70vh)] sm:h-[30rem] flex-col overflow-hidden rounded-2xl border border-border/50 bg-card/50">
        <div
          ref={wrapRef}
          className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden"
        >
          <Conversation className="h-full min-h-0 flex-1 overflow-y-auto">
            <LandingChatScrollBinder tick={scrollTick} rootRef={wrapRef} />
            <ConversationContent className="gap-4 px-4 py-4">
              {userShown.length > 0 && (
                <Message from="user">
                  <MessageContent>
                    <MessageResponse>{userShown}</MessageResponse>
                  </MessageContent>
                </Message>
              )}

              {showAssistant && (
                <Message from="assistant">
                  <MessageContent>
                    {parts.slice(0, donePartCount).map((part, index) =>
                      part.type === 'text' ? (
                        <MessageResponse
                          key={`${runKey}-${scenario}-text-${index}`}
                          mode="static"
                        >
                          {part.text}
                        </MessageResponse>
                      ) : (
                        renderCard(part, index)
                      ),
                    )}
                    {streamingPart?.type === 'text' &&
                      streamText.length > 0 && (
                        <MessageResponse mode="streaming">
                          {streamText}
                        </MessageResponse>
                      )}
                  </MessageContent>
                </Message>
              )}
            </ConversationContent>
          </Conversation>

          <AnimatePresence>
            {done && !reducedMotion && (
              <motion.div
                key="demo-replay"
                className="absolute left-3 top-3 z-30"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
              >
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 gap-1.5 px-3 text-xs shadow-sm"
                  onClick={replay}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {t('replay')}
                </Button>
              </motion.div>
            )}
          </AnimatePresence>

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
                exit={{
                  opacity: 0,
                  scale: 0.95,
                  transition: { duration: 0.08 },
                }}
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
                  setPhase('done');
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
