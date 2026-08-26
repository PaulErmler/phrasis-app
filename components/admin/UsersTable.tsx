'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useDebounce } from '@/hooks/use-debounce';
import { useNowMinute } from '@/hooks/use-now-minute';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ChevronDown } from 'lucide-react';
import { getLanguageByCode } from '@/lib/languages';
import { daysSince } from '@/convex/lib/dateUtils';

const PAGE_SIZE = 25;

type Activity = 'active_7d' | 'inactive_7d' | 'inactive_30d' | 'never';
type SortBy = 'newest' | 'streak' | 'last_active';

const ACTIVITY_OPTIONS: Array<{ value: Activity; label: string }> = [
  { value: 'active_7d', label: 'Active (last 7d)' },
  { value: 'inactive_7d', label: 'Inactive ≥7d' },
  { value: 'inactive_30d', label: 'Inactive ≥30d' },
  { value: 'never', label: 'Never active' },
];

const SORT_OPTIONS: Array<{ value: SortBy; label: string }> = [
  { value: 'newest', label: 'Newest signup' },
  { value: 'streak', label: 'Highest streak' },
  { value: 'last_active', label: 'Recently active' },
];

export function StreakBadge({
  streak,
}: {
  streak: { displayStreak: number; state: string };
}) {
  if (streak.state === 'none') {
    return <span className="text-muted-foreground">—</span>;
  }
  const icon =
    streak.state === 'frozen' ? '🧊' : streak.state === 'broken' ? '✕' : '🔥';
  return (
    <span className="tabular-nums whitespace-nowrap">
      {icon} {streak.displayStreak}
      {streak.state === 'pending' && (
        <span className="text-muted-foreground text-[10px] ml-1">pending</span>
      )}
    </span>
  );
}

export function LastActiveCell({ lastActivityDate }: { lastActivityDate?: string }) {
  if (!lastActivityDate) {
    return <span className="text-muted-foreground">never</span>;
  }
  const days = daysSince(lastActivityDate);
  return (
    <span className="whitespace-nowrap">
      {lastActivityDate}
      {days >= 7 && (
        <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 py-0">
          {days}d inactive
        </Badge>
      )}
    </span>
  );
}

const USAGE_COLUMNS: Array<{ featureId: string; label: string }> = [
  { featureId: 'credits', label: 'credits' },
  { featureId: 'chat_messages', label: 'chat' },
  { featureId: 'sentences', label: 'sentences' },
];

export function UsersTable() {
  const [search, setSearch] = useState('');
  const [selectedPlans, setSelectedPlans] = useState<string[]>([]);
  const [activity, setActivity] = useState<Activity | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortBy>('newest');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const debouncedSearch = useDebounce(search, 300);

  // Reset the page size when any filter changes.
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [debouncedSearch, selectedPlans, activity, sortBy]);

  const planDistribution = useQuery(api.admin.dashboard.getPlanDistribution, {});
  // Minute-quantized `now` per the no-wall-clock query guideline (drives the
  // activity filters and live streak derivation).
  const now = useNowMinute();
  const result = useQuery(api.admin.dashboard.listUsers, {
    limit,
    search: debouncedSearch.trim() || undefined,
    planIds: selectedPlans.length > 0 ? selectedPlans : undefined,
    activity: activity === 'all' ? undefined : activity,
    sortBy,
    now,
  });

  const planOptions = planDistribution?.plans ?? [];
  const togglePlan = (planId: string) => {
    setSelectedPlans((prev) =>
      prev.includes(planId)
        ? prev.filter((p) => p !== planId)
        : [...prev, planId],
    );
  };

  return (
    <div className="card-surface p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search by email or name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              {selectedPlans.length > 0
                ? `Plans (${selectedPlans.length})`
                : 'All plans'}
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {planOptions.map((plan) => (
              <DropdownMenuCheckboxItem
                key={plan.planId}
                checked={selectedPlans.includes(plan.planId)}
                onCheckedChange={() => togglePlan(plan.planId)}
                onSelect={(e) => e.preventDefault()}
              >
                {plan.planName}
                <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">
                  {plan.count}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
            {planOptions.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">No plans</p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Select
          value={activity}
          onValueChange={(value) => setActivity(value as Activity | 'all')}
        >
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any activity</SelectItem>
            {ACTIVITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortBy)}>
          <SelectTrigger size="sm" className="w-auto">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {result !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {result.total.toLocaleString()} user{result.total === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Streak</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead>Languages</TableHead>
              <TableHead>Usage</TableHead>
              <TableHead>Signed up</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(result?.rows ?? []).map((user) => (
              <TableRow key={user.userId}>
                <TableCell>
                  <Link
                    href={`/app/admin/users/${user.userId}`}
                    className="block hover:underline"
                  >
                    <span className="font-medium">{user.name || '—'}</span>
                    <span className="block text-xs text-muted-foreground" data-ph-mask>
                      {user.email}
                    </span>
                  </Link>
                </TableCell>
                <TableCell>
                  {user.planName ? (
                    <Badge variant="secondary" className="whitespace-nowrap">
                      {user.planName}
                      {user.planStatus && user.planStatus !== 'active' && (
                        <span className="ml-1 opacity-70">({user.planStatus})</span>
                      )}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-xs">unknown</span>
                  )}
                </TableCell>
                <TableCell>
                  <StreakBadge streak={user.streak} />
                </TableCell>
                <TableCell className="text-xs">
                  <LastActiveCell lastActivityDate={user.lastActivityDate} />
                </TableCell>
                <TableCell className="text-xs">
                  {user.targetLanguages.length > 0 ? (
                    <span className="whitespace-nowrap">
                      {user.targetLanguages
                        .map((code) => getLanguageByCode(code)?.flag ?? code)
                        .join(' ')}
                      {user.courseCount > 1 && (
                        <span className="text-muted-foreground ml-1">
                          ({user.courseCount} courses)
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs tabular-nums">
                  {user.features ? (
                    <div className="space-y-0.5">
                      {USAGE_COLUMNS.filter(({ featureId }) => user.features![featureId]).map(
                        ({ featureId, label }) => {
                          const f = user.features![featureId];
                          return (
                            <div key={featureId} className="whitespace-nowrap">
                              <span className="text-muted-foreground">{label}:</span>{' '}
                              {f.unlimited ? `${f.used} / ∞` : `${f.used} / ${f.included}`}
                            </div>
                          );
                        },
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  {new Date(user.createdAt).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
            {result !== undefined && result.rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                  No users found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {result === undefined && (
        <div className="py-6 text-center text-muted-foreground text-sm">Loading…</div>
      )}
      {result?.hasMore && (
        <div className="pt-3 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit((current) => current + PAGE_SIZE)}
          >
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
