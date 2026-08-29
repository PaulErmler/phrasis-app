'use client';

import { useTranslations } from 'next-intl';
import {
  ArrowUp,
  BookOpen,
  Clock,
  Flame,
  Headphones,
  Layers,
  MessageSquare,
  Mic,
  PenLine,
  Radio,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CEFR_COLORS } from '@/components/app/segmented/cefr';
import { PhoneShell } from '../PhoneShell';
import { HERO_STATS } from '../fixtures';

/** Mirror of ProgressStatsCard's StatColumn (ProgressStatsCard.tsx:26-95). */
function StatColumn({
  icon,
  label,
  value,
  today,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  today?: string;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-1">
      <div className="text-muted-foreground">{icon}</div>
      <p className="text-lg font-semibold tabular-nums leading-tight whitespace-nowrap">
        {value}
      </p>
      <p className="text-muted-xs leading-none">{label}</p>
      {today && (
        <p className="text-xs font-medium text-primary tabular-nums leading-none mt-0.5 whitespace-nowrap">
          {today}
        </p>
      )}
    </div>
  );
}

function ProgressStatsCardMock() {
  const t = useTranslations('AppPage');
  const tierColor = CEFR_COLORS['A2'];
  const s = HERO_STATS;

  return (
    <div className="space-y-2">
      <div className="card-surface overflow-hidden">
        <div className="h-1 bg-muted">
          <div
            className="h-full transition-all"
            style={{ width: '62%', backgroundColor: tierColor }}
          />
        </div>

        <div className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums text-primary">
                A2
              </span>
              <span className="truncate text-sm font-medium">Spanish A2.1</span>
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                · 78 / 126
              </span>
            </div>
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium tabular-nums text-primary">
              62%
            </span>
          </div>
          <div className="-mx-4 border-t" />

          <div className="flex items-end gap-4">
            <div className="flex flex-col items-center gap-0.5">
              <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-streak-active/15">
                <Flame
                  className="h-5 w-5"
                  style={{ color: 'var(--streak-active)' }}
                />
              </div>
              <span
                className="text-lg font-bold tabular-nums leading-tight"
                style={{ color: 'var(--streak-active)' }}
              >
                {s.streak}
              </span>
              <span className="text-muted-xs leading-none">
                {t('stats.streak')}
              </span>
            </div>

            <div className="w-px self-stretch bg-border" />

            <div className="flex-1 grid grid-cols-3 gap-2 sm:grid-cols-4">
              <StatColumn
                icon={<RotateCcw className="h-4 w-4" />}
                label={t('stats.reps')}
                value={s.reps.toLocaleString('en-US')}
                today={`${s.todayReps} ${t('stats.today')}`}
              />
              <StatColumn
                icon={<MessageSquare className="h-4 w-4" />}
                label={t('stats.sentences')}
                value={s.sentences.toLocaleString('en-US')}
                today={`+${s.todayNewCards} ${t('stats.new')}`}
              />
              <StatColumn
                icon={<Clock className="h-4 w-4" />}
                label={t('stats.time')}
                value="58h"
                today={`41m ${t('stats.today')}`}
              />
            </div>
          </div>
        </div>
      </div>

      {/* StartLearningButton replica (StartLearningButton.tsx:39-112, minus
          the Convex-backed ContentFilterDropdown) */}
      <div className="card-surface p-3">
        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-1.5 min-[400px]:gap-2">
            <Button
              size="lg"
              variant="outline"
              className="h-auto min-h-10 w-full items-center justify-center whitespace-normal py-2 max-[399px]:flex-col max-[399px]:gap-1 max-[399px]:px-1.5 min-[400px]:flex-row min-[400px]:gap-1.5 min-[400px]:px-2 min-[400px]:has-[>svg]:px-2"
            >
              <BookOpen className="h-4 w-4 shrink-0 min-[400px]:h-5 min-[400px]:w-5" />
              <span className="min-w-0 text-xs leading-snug [overflow-wrap:normal] [word-break:keep-all] max-[399px]:text-center min-[400px]:text-left min-[400px]:text-sm">
                {t('learnNew')}
              </span>
            </Button>
            <Button
              size="lg"
              className="h-auto min-h-10 w-full items-center justify-center whitespace-normal py-2 max-[399px]:flex-col max-[399px]:gap-1 max-[399px]:px-1.5 min-[400px]:flex-row min-[400px]:gap-1.5 min-[400px]:px-2 min-[400px]:has-[>svg]:px-2"
            >
              <RefreshCw className="h-4 w-4 shrink-0 min-[400px]:h-5 min-[400px]:w-5" />
              <span className="min-w-0 text-xs leading-snug [overflow-wrap:normal] [word-break:keep-all] max-[399px]:text-center min-[400px]:text-left min-[400px]:text-sm">
                {t('learnAndReview')}
              </span>
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-auto min-h-10 w-full items-center justify-center whitespace-normal py-2 max-[399px]:flex-col max-[399px]:gap-1 max-[399px]:px-1.5 min-[400px]:flex-row min-[400px]:gap-1.5 min-[400px]:px-2 min-[400px]:has-[>svg]:px-2"
            >
              <Radio className="h-4 w-4 shrink-0 min-[400px]:h-5 min-[400px]:w-5" />
              <span className="min-w-0 text-xs leading-snug [overflow-wrap:normal] [word-break:keep-all] max-[399px]:text-center min-[400px]:text-left min-[400px]:text-sm">
                {t('radioMode')}
              </span>
            </Button>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <div className="flex w-full rounded-lg border bg-muted/50 p-0.5 sm:flex-1">
              {[
                {
                  mode: 'audio',
                  icon: Headphones,
                  label: t('audioReview'),
                  active: true,
                },
                {
                  mode: 'full',
                  icon: PenLine,
                  label: t('fullReview'),
                  active: false,
                },
              ].map(({ mode, icon: Icon, label, active }) => (
                <button
                  key={mode}
                  type="button"
                  className={
                    active
                      ? 'flex min-h-8 flex-1 items-start justify-center gap-1.5 whitespace-normal rounded-md px-2.5 py-1.5 text-center text-xs font-medium transition-all bg-primary/15 text-primary shadow-sm ring-1 ring-primary/30'
                      : 'flex min-h-8 flex-1 items-start justify-center gap-1.5 whitespace-normal rounded-md px-2.5 py-1.5 text-center text-xs font-medium transition-all text-muted-foreground'
                  }
                >
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 text-center leading-snug">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Mirror of HomeChatInput (HomeChatInput.tsx:137-212). */
function HomeChatInputMock() {
  const t = useTranslations('Chat');
  return (
    <div className="overflow-hidden rounded-xl border bg-background shadow-sm">
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles className="h-4 w-4 shrink-0 text-primary" />
        <input
          type="text"
          readOnly
          placeholder={t('input.placeholder')}
          dir="auto"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground"
        >
          <Mic className="h-4 w-4" />
        </button>
        <button
          type="button"
          aria-label="Send"
          className="rounded-md p-1.5 text-primary-foreground bg-primary/40"
        >
          <ArrowUp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** Mirror of the SegmentedHomeSection CEFR rail + active collection card. */
function CollectionsMock() {
  const t = useTranslations('AppPage.collections.carousel');
  const groups: {
    cefr: keyof typeof CEFR_COLORS;
    pct: number;
    levels: { label: string; pct: number; focused?: boolean }[];
  }[] = [
    {
      cefr: 'A1',
      pct: 1,
      levels: [
        { label: 'A1.1', pct: 1 },
        { label: 'A1.2', pct: 1 },
        { label: 'A1.3', pct: 1 },
      ],
    },
    {
      cefr: 'A2',
      pct: 0.42,
      levels: [
        { label: 'A2.1', pct: 0.62, focused: true },
        { label: 'A2.2', pct: 0.18 },
        { label: 'A2.3', pct: 0 },
      ],
    },
    {
      cefr: 'B1',
      pct: 0,
      levels: [
        { label: 'B1.1', pct: 0 },
        { label: 'B1.2', pct: 0 },
      ],
    },
  ];

  return (
    <Tabs value="premade" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <h2 className="heading-section min-w-0 truncate">
          {t('sectionTitle')}
        </h2>
        <TabsList className="shrink-0">
          <TabsTrigger value="premade">{t('tabPremade')}</TabsTrigger>
          <TabsTrigger value="custom">{t('tabCustom')}</TabsTrigger>
        </TabsList>
      </div>

      <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pt-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map((g) => (
          <div key={g.cefr} className="flex shrink-0 flex-col gap-1.5">
            <div className="flex items-center gap-1.5 px-0.5">
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: CEFR_COLORS[g.cefr] }}
                aria-hidden
              />
              <span className="font-mono text-[10px] font-bold tracking-widest text-foreground">
                {g.cefr}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {Math.round(g.pct * 100)}%
              </span>
            </div>
            <div className="flex gap-1">
              {g.levels.map((level) => (
                <div
                  key={level.label}
                  className={
                    level.focused
                      ? 'relative flex h-14 w-14 flex-col items-center justify-center overflow-hidden rounded-lg border transition-all border-primary bg-primary/5 shadow-sm ring-2 ring-primary'
                      : 'relative flex h-14 w-14 flex-col items-center justify-center overflow-hidden rounded-lg border transition-all border-border bg-card'
                  }
                >
                  <div
                    className="absolute inset-x-0 bottom-0"
                    style={{
                      height: `${level.pct * 100}%`,
                      backgroundColor: `color-mix(in oklch, ${CEFR_COLORS[g.cefr]} 22%, transparent)`,
                    }}
                  />
                  <span className="relative z-10 font-mono text-[10px] font-bold tabular-nums tracking-tight">
                    {level.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Active collection detail (CollectionCarouselUI.tsx InlineCollectionDetail) */}
      <div className="rounded-xl border-2 bg-card overflow-hidden">
        <div className="h-1.5 bg-muted">
          <div
            className="h-full transition-all bg-primary"
            style={{ width: '62%' }}
          />
        </div>
        <div className="p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">A2.1</h3>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium px-2.5 py-0.5 rounded-full bg-primary/15 text-primary ring-1 ring-primary/30">
                {t('inline.active')}
              </span>
              <span className="text-[10px] font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full tabular-nums">
                62%
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {t('descriptions.A2_1')}
          </p>
          <div className="flex gap-3 text-xs">
            <div className="flex items-center gap-1">
              <Layers className="h-3 w-3 text-muted-foreground" />
              <span>78 {t('inline.added')}</span>
            </div>
            <div className="flex items-center gap-1">
              <BookOpen className="h-3 w-3 text-muted-foreground" />
              <span>48 {t('inline.remaining')}</span>
            </div>
          </div>
        </div>
      </div>
    </Tabs>
  );
}

export function HomeScreen() {
  const t = useTranslations('AppPage');
  return (
    <PhoneShell
      activeView="home"
      courseLabel={t('currentCourseWithLanguages', {
        targetLanguages: 'Spanish',
      })}
    >
      <div className="scroll-view" style={{ scrollbarGutter: 'stable' }}>
        <div className="app-view">
          <ProgressStatsCardMock />

          <div className="card-surface space-y-2 p-3">
            <HomeChatInputMock />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="lg" className="w-full gap-2">
                <MessageSquare className="h-4 w-4" />
                {t('content.chat.title')}
              </Button>
              <Button variant="outline" size="lg" className="w-full gap-2">
                <PenLine className="h-4 w-4" />
                {t('customContent')}
              </Button>
            </div>
          </div>

          <div className="card-surface space-y-3 p-3">
            <CollectionsMock />
          </div>
        </div>
      </div>
    </PhoneShell>
  );
}
