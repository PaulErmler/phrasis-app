'use client';

import { useState } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { getLanguageByCode } from '@/lib/languages';
import { formatTimeMs } from '@/lib/formatTime';
import { TimeSeriesCard } from './TimeSeriesCard';
import { DistributionCard } from './DistributionCard';
import { UsersTable } from './UsersTable';
import { AdminGuard } from './AdminGuard';

const RANGES = [30, 60, 90] as const;

function languageName(code: string): string {
  return getLanguageByCode(code)?.name ?? code;
}

export function AdminDashboardView() {
  return (
    <AdminGuard>
      <AdminDashboardContent />
    </AdminGuard>
  );
}

function AdminDashboardContent() {
  const [days, setDays] = useState<number>(30);

  const dau = useQuery(api.admin.dashboard.getDauSeries, { days });
  const signups = useQuery(api.admin.dashboard.getSignupSeries, { days });
  const plans = useQuery(api.admin.dashboard.getPlanDistribution, {});
  const languages = useQuery(api.admin.dashboard.getLanguageStats, {});
  const funnel = useQuery(api.admin.dashboard.getOnboardingFunnel, {});

  const todayDau = dau?.[dau.length - 1]?.activeUsers;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 md:py-8">
        <h1 className="text-xl font-bold mb-4">Admin</h1>
        <Tabs defaultValue="overview">
          <TabsList className="mb-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Users</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            <div className="flex justify-end gap-2 text-xs">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setDays(r)}
                  className={cn(
                    'transition-colors',
                    days === r ? 'text-primary font-medium' : 'text-muted-foreground',
                  )}
                >
                  {r}d
                </button>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <TimeSeriesCard
                title="Daily active users"
                valueLabel="active users"
                isLoading={dau === undefined}
                headline={todayDau !== undefined ? `${todayDau} today` : undefined}
                data={(dau ?? []).map((d) => ({
                  date: d.date,
                  value: d.activeUsers,
                  extra: {
                    reviews: d.totalReps,
                    'study time': formatTimeMs(d.totalTimeMs),
                  },
                }))}
              />
              <TimeSeriesCard
                title="Signups"
                valueLabel="signups"
                isLoading={signups === undefined}
                headline={
                  signups !== undefined
                    ? `${signups.totalUsers.toLocaleString()} users total`
                    : undefined
                }
                data={(signups?.series ?? []).map((d) => ({
                  date: d.date,
                  value: d.signups,
                }))}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <DistributionCard
                title="Users per plan"
                isLoading={plans === undefined}
                headline={
                  plans !== undefined ? `${plans.totalWithQuotas} synced` : undefined
                }
                rows={(plans?.plans ?? []).map((p) => ({
                  label: p.planName,
                  count: p.count,
                }))}
              />
              <DistributionCard
                title="Target languages"
                isLoading={languages === undefined}
                rows={(languages?.targetLanguages ?? []).map((l) => ({
                  label: languageName(l.language),
                  count: l.count,
                }))}
              />
              <DistributionCard
                title="Levels"
                isLoading={languages === undefined}
                rows={(languages?.levels ?? []).map((l) => ({
                  label: l.level.replace(/_/g, ' '),
                  count: l.count,
                }))}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <DistributionCard
                title="Onboarding — in progress by step"
                isLoading={funnel === undefined}
                headline={
                  funnel !== undefined
                    ? `${funnel.completed}/${funnel.total} completed`
                    : undefined
                }
                rows={(funnel?.inProgressBySteps ?? []).map((s) => ({
                  label: `Step ${s.step}`,
                  count: s.count,
                }))}
              />
              <DistributionCard
                title="Acquisition sources"
                isLoading={funnel === undefined}
                rows={(funnel?.acquisitionSources ?? []).map((s) => ({
                  label: s.source.replace(/_/g, ' '),
                  count: s.count,
                }))}
              />
              <DistributionCard
                title="Learning goals"
                isLoading={funnel === undefined}
                rows={(funnel?.learningGoals ?? []).map((g) => ({
                  label: g.goal.replace(/_/g, ' '),
                  count: g.count,
                }))}
              />
            </div>
          </TabsContent>

          <TabsContent value="users">
            <UsersTable />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
