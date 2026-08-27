'use client';

/**
 * Store-screenshot screens. Every app screen here mounts the SAME components
 * the app renders in production and feeds them fixture data. The two poster
 * frames (opener, modes) are marketing art and say so.
 */
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LearningCardContent } from '@/components/app/learning/LearningCardContent';
import { LearningControls } from '@/components/app/learning/LearningControls';
import { ProgressDisplay } from '@/components/app/learning/ProgressDisplay';
import { LearningHeader } from '@/components/app/learning/LearningHeader';
import { LearningChatContext } from '@/components/app/learning/LearningChatLayout';
import { ChatMessages } from '@/components/chat/ChatMessages';
import { EntryLines } from '@/components/chat/CardApproval';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { NumbersRow } from '@/components/app/stats/NumbersRow';
import { SegmentedHomeSection } from '@/components/app/segmented/SegmentedHomeSection';
import { FullReviewCardContent } from '@/components/app/learning/FullReviewCardContent';
import { WordCloudSection } from '@/components/app/stats/WordCloudCard';
import { LandingWordCloud } from '@/components/landing/LandingWordCloud';
import { DailyGoalRing } from '@/components/app/stats/DailyGoalRing';
import { RotatingProjection } from '@/components/app/stats/RotatingProjection';
import { CumulativeLineChart } from '@/components/app/stats/CumulativeLineChart';
import { BottomNav } from '@/components/app/BottomNav';
import { Screen, Poster } from './StoreFrame';
import { MockConvex, PRELOADED } from './mockConvex';
import { BASE_LANGS, LANGS, GROUPED, COUNTS, type LangPill } from './languages';
import { AppDataContext } from '@/components/app/AppDataProvider';
import { ProgressStatsCard } from '@/components/app/ProgressStatsCard';
import { SAMPLES, REJECT_SAMPLE } from './chatContent';
import * as fx from './fixtures';

const noop = () => {};

/** Shared CardPresentation stub; spread with per-screen card content. */
const cardStubs = {
  isFavorite: false,
  isPendingMaster: false,
  isPendingHide: false,
  onMaster: noop,
  onHide: noop,
  onFavorite: noop,
  preReviewCount: 3,
  schedulingPhase: 'review' as const,
  fsrsState: { reps: 6 },
};

/** Canned app data so home's stats card can mount outside /app. */
function WithAppData({ children }: { children: ReactNode }) {
  return (
    <AppDataContext.Provider
      value={
        {
          preloadedHomeSummary: PRELOADED.homeSummary,
          preloadedCourseSettings: PRELOADED.courseSettings,
          preloadedSettings: PRELOADED.settings,
          preloadedActiveCourse: PRELOADED.activeCourse,
          activeCourse: { _id: 'course-1', currentLevel: 'A2' },
          courseSettings: { reviewMode: 'audio', dailyTimeGoalMinutes: 20 },
        } as never
      }
    >
      {children}
    </AppDataContext.Provider>
  );
}

function WithChatContext({ children }: { children: ReactNode }) {
  return (
    <LearningChatContext.Provider
      value={
        {
          isChatOpen: false,
          openChat: noop,
          closeChat: noop,
          toggleChat: noop,
          openChatWithAction: noop,
        } as never
      }
    >
      {children}
    </LearningChatContext.Provider>
  );
}

// ----------------------------------------------------------- learning screen

/** The whole learning view: header, card, rating row and transport. */
export function LearnScreen() {
  return (
    <WithChatContext>
      <div className="absolute inset-0 flex flex-col bg-background text-foreground pt-4">
        <LearningHeader onBack={noop} onSettingsOpen={noop} ratingCount={4} />
        <main className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden px-4">
          <LearningCardContent
            bare
            presentation={{
              ...cardStubs,
              sourceText: fx.shadowCard.sourceText,
              translations: fx.shadowCard.translations,
              audioRecordings: fx.shadowCard.audioRecordings,
            }}
          />
        </main>
        <LearningControls
          validRatings={['again', 'hard', 'good', 'easy']}
          activeRating={'good' as never}
          ratingIntervals={{ again: '<1m', hard: '6m', good: '3d', easy: '8d' }}
          onSelectRating={noop}
          onPlay={noop}
          onPause={noop}
          isPlaying={false}
          isMerging={false}
          durationSec={4.2}
          onSeek={noop}
          onNext={noop}
          onUndo={noop}
          undoDisabled={false}
          isReviewing={false}
          isAudioReview
        />
      </div>
    </WithChatContext>
  );
}

// ------------------------------------------------------------------- chat

function msg(
  id: string,
  role: 'user' | 'assistant',
  text: string,
  order: number,
): never {
  return {
    id,
    key: id,
    role,
    order,
    stepOrder: 0,
    status: 'success',
    text,
    content: text,
    _creationTime: 1_700_000_000_000 + order,
    parts: [{ type: 'text', text }],
  } as never;
}

function ApprovalBox({
  base,
  target,
  approved = false,
}: {
  base: string;
  target: string;
  approved?: boolean;
}) {
  return (
    <Alert
      className={`my-3 flex flex-col gap-3 ${
        approved
          ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'
          : ''
      }`}
    >
      <AlertDescription>
        <EntryLines
          baseEntries={[{ language: 'en', text: base }]}
          targetEntries={[{ language: 'es', text: target }]}
        />
      </AlertDescription>
      <div className="flex w-full items-center gap-2">
        {approved ? (
          <Button
            disabled
            variant="ghost"
            size="sm"
            className="h-9 px-3 text-base font-semibold text-success"
          >
            Sentence added!
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" className="h-9 px-3 text-base">
              Reject
            </Button>
            <Button size="sm" className="h-9 px-3 text-base">
              Add Sentence
            </Button>
          </>
        )}
      </div>
    </Alert>
  );
}

/** Chat header without the placeholder avatar or the signed-in user menu. */
function TutorHeader() {
  return (
    <header className="shrink-0 border-b bg-background">
      <div className="flex h-16 items-center gap-3 px-4">
        <ArrowLeft className="h-5 w-5 text-muted-foreground" />
        <span className="text-lg font-semibold">Tutor</span>
      </div>
    </header>
  );
}

function Composer() {
  return (
    <div className="flex items-center gap-2 rounded-full border px-4 py-3 text-base text-muted-foreground">
      <span className="flex-1">Ask about this sentence…</span>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground text-base">
        ↑
      </span>
    </div>
  );
}

/** The tutor page, with the app's own header and composer. */
function ChatScreen({
  sampleIndex = 0,
  chatHeight = 'h-[300px]',
  children,
}: {
  sampleIndex?: number;
  chatHeight?: string;
  children: ReactNode;
}) {
  const sample = SAMPLES[sampleIndex];
  const thread = [
    msg(`${sample.id}-q`, 'user', sample.question, 0),
    msg(`${sample.id}-a`, 'assistant', sample.answer, 1),
  ];
  return (
    <div className="absolute inset-0 flex flex-col bg-background text-foreground">
      <TutorHeader />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
        <div className={`${chatHeight} shrink-0 overflow-hidden`}>
          <ChatMessages
            messages={thread}
            isLoading={false}
            threadId="demo"
            status="ready"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-1">{children}</div>
      </div>
      <div className="flex-none border-t px-4 py-3">
        <Composer />
      </div>
    </div>
  );
}

/** An answer that ends in a card the learner has already accepted. */
export function ChatAnswerScreen({
  sampleIndex = 0,
}: {
  sampleIndex?: number;
}) {
  const sample = SAMPLES[sampleIndex];
  return (
    <ChatScreen sampleIndex={sampleIndex}>
      <ApprovalBox
        base={sample.card.base}
        target={sample.card.target}
        approved
      />
      <ApprovalBox base="I did it because of you." target="Lo hice por ti." />
    </ChatScreen>
  );
}

/** Several drafted cards waiting on the learner. */
export function ChatCardsScreen() {
  const thread = [
    msg('r-q', 'user', REJECT_SAMPLE.question, 0),
    msg('r-a', 'assistant', REJECT_SAMPLE.answer, 1),
  ];
  return (
    <div className="absolute inset-0 flex flex-col bg-background text-foreground">
      <TutorHeader />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
        <div className="h-[112px] shrink-0 overflow-hidden">
          <ChatMessages
            messages={thread}
            isLoading={false}
            threadId="demo"
            status="ready"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden px-1">
          <ApprovalBox {...REJECT_SAMPLE.cards[0]} approved />
          <ApprovalBox {...REJECT_SAMPLE.cards[1]} />
          <ApprovalBox {...REJECT_SAMPLE.cards[2]} />
        </div>
      </div>
      <div className="flex-none border-t px-4 py-3">
        <Composer />
      </div>
    </div>
  );
}

// -------------------------------------------------------------- home + stats

/** The statistics view: what you have done, and every word it added up to. */
export function HomeProjectionScreen() {
  return (
    <MockConvex>
      <div className="absolute inset-0 flex flex-col bg-background text-foreground">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-3 pt-6">
          <NumbersRow {...fx.numbers} />
          <CumulativeLineChart
            dailyData={fx.dailyData}
            monthlyData={fx.monthlyData}
            weeklyData={fx.weeklyData}
            languageDailyData={fx.languageDailyData}
            timezone={fx.TZ}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
            <WordCloudSection />
          </div>
        </div>
        <BottomNav
          currentView={'stats' as never}
          onViewChange={noop}
          onLearnOpen={noop}
        />
      </div>
    </MockConvex>
  );
}

/** Home in full: the stats card and the whole level-selection section. */
export function DifficultyScreen() {
  return (
    <MockConvex>
      <WithAppData>
        <div className="absolute inset-0 flex flex-col bg-background text-foreground">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-3 pt-6">
            <ProgressStatsCard
              onStartLearn={noop}
              onReviewModeChange={noop}
              hasPlayableCards
            />
            <SegmentedHomeSection
              onNavigateToContent={noop}
              onNavigateToChat={noop}
            />
          </div>
          <BottomNav
            currentView={'home' as never}
            onViewChange={noop}
            onLearnOpen={noop}
          />
        </div>
      </WithAppData>
    </MockConvex>
  );
}

/** Writing mode: type the sentence, see every character you missed. */
export function WriteScreen() {
  return (
    <WithChatContext>
      <div className="absolute inset-0 flex flex-col bg-background text-foreground pt-4">
        <LearningHeader
          onBack={noop}
          onSettingsOpen={noop}
          reviewMode="full"
          ratingCount={4}
        />
        <main className="flex min-h-0 flex-1 flex-col justify-center overflow-hidden px-4">
          <FullReviewCardContent
            bare
            presentation={{
              ...cardStubs,
              sourceText: fx.writeCard.sourceText,
              translations: fx.writeCard.translations,
              audioRecordings: fx.writeCard.audioRecordings,
            }}
            targetAudioMode="afterSubmit"
          />
        </main>
        <LearningControls
          validRatings={['again', 'hard', 'good', 'easy']}
          activeRating={'good' as never}
          ratingIntervals={{ again: '<1m', hard: '6m', good: '3d', easy: '8d' }}
          onSelectRating={noop}
          onPlay={noop}
          onPause={noop}
          isPlaying={false}
          isMerging={false}
          durationSec={3.4}
          onSeek={noop}
          onNext={noop}
          onUndo={noop}
          undoDisabled={false}
          isReviewing={false}
          isFullReview
          fullReviewRevealed
        />
      </div>
    </WithChatContext>
  );
}

/** The milestone screen the learner meets partway through a session. */
export function ProgressScreen() {
  return (
    <MockConvex>
      {/* ProgressDisplay reads getUserSettings via AppDataProvider. */}
      <WithAppData>
        <WithChatContext>
          <div className="absolute inset-0 flex flex-col bg-background text-foreground pt-4">
            <LearningHeader
              onBack={noop}
              onSettingsOpen={noop}
              ratingCount={4}
            />
            <div className="min-h-0 flex-1 overflow-hidden">
              <ProgressDisplay
                sessionId="store-session"
                dailyReviewsToday={74}
                dailyTimeMsToday={21 * 60 * 1000}
                dailyNewWordsToday={20}
                reviewMode="audio"
                autoAdvance={false}
                onContinue={noop}
                ready
              />
            </div>
          </div>
        </WithChatContext>
      </WithAppData>
    </MockConvex>
  );
}

/** Everything the learner already knows, as one picture. */
export function WordCloudScreen() {
  return (
    <div className="absolute inset-0 flex flex-col bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-hidden p-4 pt-8">
        <LandingWordCloud />
      </div>
      <BottomNav
        currentView={'stats' as never}
        onViewChange={noop}
        onLearnOpen={noop}
      />
    </div>
  );
}

// ------------------------------------------------------------------ posters

const BRAND = {
  clay: '#D45C2B',
  sky: '#2BB5D4',
  amber: '#FFB300',
  ink: '#0B2A35',
};

const PILLARS = [
  {
    n: '01',
    title: 'Practice for every moment',
    body: 'Speak on a walk, write at a desk, or let sentences play while you cook.',
    color: BRAND.clay,
  },
  {
    n: '02',
    title: 'Content that is actually yours',
    body: 'Practical sentences you will say. Bring your own, or ask the tutor.',
    color: BRAND.sky,
  },
  {
    n: '03',
    title: 'A path you can see',
    body: 'Stats, a review plan, and a projection of where you are headed.',
    color: BRAND.amber,
  },
];

function Wordmark({
  color = '#fff',
  size = 130,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 38 }}>
      <div
        style={{
          background: '#fff',
          borderRadius: 46,
          padding: 18,
          flex: '0 0 auto',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-512x512.png"
          alt=""
          width={size}
          height={size}
          style={{ display: 'block' }}
        />
      </div>
      <p
        style={{
          margin: 0,
          fontSize: size * 0.82,
          fontWeight: 800,
          letterSpacing: '-0.04em',
          color,
          lineHeight: 1,
        }}
      >
        Flexling
      </p>
    </div>
  );
}

const TAGLINE = 'Learn a language the way you learned your first.';

const PILLARS_COPY = [
  {
    label: 'Flexibility',
    line: 'Speak on a walk with hands-free audio review, write at a desk, or let sentences play while you cook.',
    color: BRAND.clay,
  },
  {
    label: 'Motivation',
    line: 'Stats, a review plan with state of the art spaced repetition, and a projection of when you will reach your goals.',
    color: BRAND.sky,
  },
  {
    label: 'Usefulness',
    line: 'Practical sentences you will actually use. You can also add your own and ask AI to create them for you.',
    color: BRAND.amber,
  },
];

/** A hero block over three cards. Shared by the opener and the modes frame. */
function HeroPoster({
  heroBg,
  heading,
  headingSize = 96,
  wordmark = false,
  cards,
}: {
  heroBg: string;
  heading: string;
  headingSize?: number;
  wordmark?: boolean;
  cards: { label: string; line: string; color: string }[];
}) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#EEF4F6',
      }}
    >
      <div
        style={{
          background: heroBg,
          padding: wordmark ? '104px 84px 84px' : '116px 84px 92px',
        }}
      >
        {wordmark && <Wordmark size={140} />}
        <p
          style={{
            margin: wordmark ? '44px 0 0' : 0,
            fontSize: headingSize,
            lineHeight: 1.05,
            fontWeight: 800,
            color: '#fff',
            maxWidth: '15ch',
            letterSpacing: '-0.035em',
          }}
        >
          {heading}
        </p>
      </div>
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          padding: '40px 84px 76px',
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              flex: 1,
              background: '#fff',
              borderRadius: 40,
              padding: '36px 46px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 14,
            }}
          >
            <span
              style={{
                fontSize: 36,
                fontWeight: 800,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: c.color,
              }}
            >
              {c.label}
            </span>
            <p
              style={{
                margin: 0,
                fontSize: 58,
                fontWeight: 700,
                letterSpacing: '-0.026em',
                lineHeight: 1.14,
                color: '#0D1416',
              }}
            >
              {c.line}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Opening frame. */
export function OpenerScreen() {
  return (
    <HeroPoster
      heroBg={BRAND.sky}
      heading={TAGLINE}
      wordmark
      cards={PILLARS_COPY}
    />
  );
}

/** The three ways one card can be practised. */
export function ModesScreen() {
  return (
    <HeroPoster
      heroBg={BRAND.clay}
      heading="Listen, translate or transcribe."
      headingSize={104}
      cards={[
        {
          label: 'Listen',
          line: 'Hear the sentence, translate it in your head, then say it aloud. Hands-free.',
          color: BRAND.clay,
        },
        {
          label: 'Translate',
          line: 'Hear it in your language and type the target, with character-level feedback.',
          color: BRAND.sky,
        },
        {
          label: 'Transcribe',
          line: 'Hear only the target language and type back exactly what you heard.',
          color: BRAND.amber,
        },
      ]}
    />
  );
}

export const SCREENS: Record<string, () => ReactNode> = {
  opener: () => <OpenerScreen />,
  modes: () => <ModesScreen />,
  learn: () => <LearnScreen />,
  write: () => <WriteScreen />,
  'chat-answer': () => <ChatAnswerScreen sampleIndex={0} />,
  'chat-answer-2': () => <ChatAnswerScreen sampleIndex={2} />,
  'chat-cards': () => <ChatCardsScreen />,
  'home-projection': () => <HomeProjectionScreen />,
  difficulty: () => <DifficultyScreen />,
  progress: () => <ProgressScreen />,
  langs: () => <LangsScreen />,
};

// ---------------------------------------------------------------- languages

/**
 * Five ways to show the catalogue. All read from SUPPORTED_LANGUAGES, so the
 * names, flags and counts are whatever the app actually ships.
 */
function LangHead({ color = '#fff', sub }: { color?: string; sub: string }) {
  return (
    <>
      <p
        style={{
          margin: 0,
          fontSize: 104,
          lineHeight: 1.02,
          fontWeight: 800,
          letterSpacing: '-0.038em',
          color,
        }}
      >
        One method.
        <br />
        {COUNTS.languages}+ languages.
      </p>
      <p
        style={{
          margin: '26px 0 0',
          fontSize: 46,
          lineHeight: 1.32,
          color,
          opacity: 0.82,
          maxWidth: '26ch',
        }}
      >
        {sub}
      </p>
    </>
  );
}

function Pill({
  l,
  bg,
  fg,
  border,
  size = 40,
}: {
  l: LangPill;
  bg: string;
  fg: string;
  border?: string;
  size?: number;
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 14,
        background: bg,
        color: fg,
        border: border ? `2px solid ${border}` : 'none',
        borderRadius: 999,
        padding: size >= 50 ? '18px 30px' : '14px 26px',
        fontSize: size,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: size * 1.05 }}>{l.flag}</span>
      {l.label}
    </span>
  );
}

/** The catalogue: flag-and-name pills, sized to read at thumbnail scale. */
export function LangsScreen() {
  return (
    <Poster bg={BRAND.sky}>
      <p
        style={{
          margin: 0,
          fontSize: 108,
          lineHeight: 1.02,
          fontWeight: 800,
          letterSpacing: '-0.038em',
          color: '#fff',
        }}
      >
        One method.
        <br />
        {COUNTS.languages}+ languages.
      </p>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 20,
          alignContent: 'center',
          flex: 1,
          paddingTop: 52,
        }}
      >
        {BASE_LANGS.map((l) => (
          <Pill
            key={l.code}
            l={l}
            bg="rgba(255,255,255,.18)"
            fg="#fff"
            size={54}
          />
        ))}
      </div>
    </Poster>
  );
}
