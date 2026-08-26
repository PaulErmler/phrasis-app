'use client';

import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useNowMinute } from '@/hooks/use-now-minute';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { languageName } from '@/lib/languages';
import { formatTimeMs } from '@/lib/formatTime';
import { StreakBadge, LastActiveCell } from './UsersTable';
import { UserThreadsBrowser } from './UserThreadsBrowser';
import { UserTextsBrowser } from './UserTextsBrowser';
import { AdminGuard } from './AdminGuard';

function languageNames(codes: string[]): string {
  return codes.map(languageName).join(', ');
}

export function AdminUserDetailView({ userId }: { userId: string }) {
  return (
    <AdminGuard>
      <AdminUserDetailContent userId={userId} />
    </AdminGuard>
  );
}

function AdminUserDetailContent({ userId }: { userId: string }) {
  // Minute-quantized `now` per the no-wall-clock query guideline (live
  // streak derivation).
  const now = useNowMinute();
  const detail = useQuery(api.admin.dashboard.getUserDetail, { userId, now });

  if (detail === undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (detail === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">
        User not found
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-6 md:py-8 space-y-3">
        <Link
          href="/app/admin"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Admin
        </Link>

        {/* Header */}
        <div className="card-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            {detail.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={detail.image}
                alt=""
                className="h-10 w-10 rounded-full"
              />
            )}
            <div className="min-w-0">
              <h1 className="text-lg font-bold truncate">{detail.name || '—'}</h1>
              <p className="text-sm text-muted-foreground truncate" data-ph-mask>
                {detail.email}
              </p>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2 text-xs">
              {detail.planName && (
                <Badge variant="secondary">
                  {detail.planName}
                  {detail.planStatus && detail.planStatus !== 'active' && (
                    <span className="ml-1 opacity-70">({detail.planStatus})</span>
                  )}
                </Badge>
              )}
              {!detail.hasCompletedOnboarding && (
                <Badge variant="outline">onboarding incomplete</Badge>
              )}
              <span className="text-muted-foreground">
                Signed up {new Date(detail.createdAt).toLocaleDateString()}
              </span>
            </div>
          </div>
          {detail.onboarding && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {detail.onboarding.acquisitionSource && (
                <span>Source: {detail.onboarding.acquisitionSource.replace(/_/g, ' ')}</span>
              )}
              {detail.onboarding.learningGoals && detail.onboarding.learningGoals.length > 0 && (
                <span>
                  Goals: {detail.onboarding.learningGoals.map((g) => g.replace(/_/g, ' ')).join(', ')}
                </span>
              )}
              {detail.onboarding.dailyTimeGoalMinutes !== undefined && (
                <span>Daily goal: {detail.onboarding.dailyTimeGoalMinutes} min</span>
              )}
            </div>
          )}
        </div>

        {/* Courses */}
        <div className="card-surface p-4">
          <p className="text-sm font-semibold text-muted-foreground mb-3">
            Courses ({detail.courses.length})
          </p>
          {detail.courses.length === 0 ? (
            <p className="text-sm text-muted-foreground">No courses</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {detail.courses.map((course) => (
                <div
                  key={course.courseId}
                  className="rounded-lg border border-border/50 p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="font-medium truncate">
                      {languageNames(course.targetLanguages)}
                      <span className="text-muted-foreground font-normal">
                        {' '}from {languageNames(course.baseLanguages)}
                      </span>
                    </span>
                    {course.isArchived && <Badge variant="outline">archived</Badge>}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {course.currentLevel && (
                      <span>{course.currentLevel.replace(/_/g, ' ')}</span>
                    )}
                    <span>{course.cardCount.toLocaleString()} cards</span>
                    <span>{course.totalRepetitions.toLocaleString()} reviews</span>
                    <span>{formatTimeMs(course.totalTimeMs)}</span>
                    <span>{course.totalChatMessages.toLocaleString()} chat msgs</span>
                    <span>
                      <StreakBadge streak={course.streak} />
                    </span>
                    <LastActiveCell lastActivityDate={course.lastActivityDate} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Feature usage */}
        <div className="card-surface p-4">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-sm font-semibold text-muted-foreground">Feature usage</p>
            {detail.quotasLastSyncedAt && (
              <p className="text-xs text-muted-foreground">
                synced {new Date(detail.quotasLastSyncedAt).toLocaleString()}
              </p>
            )}
          </div>
          {!detail.features ? (
            <p className="text-sm text-muted-foreground">No quota data</p>
          ) : (
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(detail.features).map(([featureId, f]) => (
                <div key={featureId} className="text-xs">
                  <div className="flex items-baseline justify-between mb-0.5">
                    <span className="font-medium">{featureId.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {f.unlimited ? `${f.used} / ∞` : `${f.used} / ${f.included}`}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: f.unlimited
                          ? '100%'
                          : `${Math.min(100, (f.used / Math.max(1, f.included)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Content browsers */}
        <Tabs defaultValue="chats">
          <TabsList className="mb-3">
            <TabsTrigger value="chats">Chats</TabsTrigger>
            <TabsTrigger value="cards">Custom cards</TabsTrigger>
          </TabsList>
          <TabsContent value="chats">
            <UserThreadsBrowser userId={userId} />
          </TabsContent>
          <TabsContent value="cards">
            <UserTextsBrowser userId={userId} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
