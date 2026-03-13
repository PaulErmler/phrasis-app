'use client';

import { useQuery, useMutation, useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw,
  Trash2,
  MessageSquare,
  BookOpen,
  FileText,
  Sparkles,
  Loader2,
  Lock,
} from 'lucide-react';
import { useCustomer, PaywallDialog } from 'autumn-js/react';
import { authClient } from '@/lib/auth-client';
import { useConvexAuth } from 'convex/react';

type FeatureState = {
  balance: number;
  included: number;
  used: number;
  interval?: string;
  unlimited?: boolean;
};

const FEATURE_META: Record<
  string,
  { label: string; icon: typeof MessageSquare; description: string }
> = {
  chat_messages: {
    label: 'Chat Messages',
    icon: MessageSquare,
    description: 'Chat messages per month',
  },
  courses: {
    label: 'Courses',
    icon: BookOpen,
    description: 'Total courses (non-consumable)',
  },
  sentences: {
    label: 'Sentences',
    icon: FileText,
    description: 'Sentences from built-in collections per month',
  },
  custom_sentences: {
    label: 'Custom Sentences',
    icon: Sparkles,
    description: 'AI-generated custom sentences per month',
  },
};

export default function TrackingPrototypePage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const { isAuthenticated, isLoading: convexAuthLoading } = useConvexAuth();

  if (sessionPending || convexAuthLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  if (!session || !isAuthenticated) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <p className="text-muted-foreground text-sm">Sign in to access the usage tracking prototype.</p>
      </div>
    );
  }

  return <TrackingContent />;
}

function TrackingContent() {
  const quotaDoc = useQuery(api.usage.queries.getMyQuotas);
  const syncQuotas = useAction(api.usage.actions.syncQuotas);
  const getAutumn = useAction(api.usage.actions.getAutumnEntitlements);
  const resetQuotas = useAction(api.usage.testOperations.resetMyQuotas);

  const simulateChat = useMutation(api.usage.testOperations.simulateChatMessage);
  const simulateSentence = useMutation(api.usage.testOperations.simulateSentence);
  const simulateCustom = useMutation(api.usage.testOperations.simulateCustomSentence);
  const simulateCourse = useMutation(api.usage.testOperations.simulateCourse);

  const { customer } = useCustomer();

  const [autumnData, setAutumnData] = useState<Record<string, FeatureState> | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{
    feature: string;
    allowed: boolean;
    balance: number;
  } | null>(null);
  const [paywallFeatureId, setPaywallFeatureId] = useState<string | null>(null);

  const withLoading = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      setLoading(key);
      try {
        await fn();
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(null);
      }
    },
    [],
  );

  const handleSync = () =>
    withLoading('sync', async () => {
      await syncQuotas();
    });

  const handleFetchAutumn = () =>
    withLoading('autumn', async () => {
      const data = await getAutumn();
      setAutumnData(data);
    });

  const handleReset = () =>
    withLoading('reset', async () => {
      await resetQuotas();
      setAutumnData(null);
      setLastResult(null);
    });

  const handleSimulate = (feature: string, fn: () => Promise<{ allowed: boolean; balance: number }>) =>
    withLoading(feature, async () => {
      const result = await fn();
      setLastResult({ feature, ...result });
      if (!result.allowed) {
        setPaywallFeatureId(feature);
      }
    });

  const handleUpgrade = (featureId: string) => {
    setPaywallFeatureId(featureId);
  };

  const localFeatures = quotaDoc?.features ?? {};

  // Merge feature keys from local, autumn, and FEATURE_META
  const allFeatureIds = new Set([
    ...Object.keys(FEATURE_META),
    ...Object.keys(localFeatures),
    ...Object.keys(autumnData ?? {}),
  ]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Usage Tracking Prototype</h1>
          <p className="text-muted-foreground text-sm">
            Test quota checking, local caching, and Autumn sync
          </p>
          {quotaDoc && (
            <p className="text-muted-foreground/60 text-xs">
              Last synced: {new Date(quotaDoc.lastSyncedAt).toLocaleTimeString()}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSync} disabled={loading !== null}>
            {loading === 'sync' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Sync from Autumn
          </Button>
          <Button variant="outline" size="sm" onClick={handleFetchAutumn} disabled={loading !== null}>
            {loading === 'autumn' ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Fetch Autumn Live
          </Button>
          <Button variant="destructive" size="sm" onClick={handleReset} disabled={loading !== null}>
            {loading === 'reset' ? <Loader2 className="animate-spin" /> : <Trash2 />}
            Reset Local
          </Button>
        </div>
      </div>

      {lastResult && (
        <Card
          className={
            lastResult.allowed
              ? 'border-green-500/50 bg-green-500/5'
              : 'border-red-500/50 bg-red-500/5'
          }
        >
          <CardContent className="flex items-center gap-3 py-3">
            <Badge variant={lastResult.allowed ? 'default' : 'destructive'}>
              {lastResult.allowed ? 'Allowed' : 'Denied'}
            </Badge>
            <span className="text-sm">
              <strong>{FEATURE_META[lastResult.feature]?.label ?? lastResult.feature}</strong>
              {' — '}
              {lastResult.allowed
                ? `Remaining balance: ${lastResult.balance}`
                : 'Usage limit reached or quotas not synced'}
            </span>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {[...allFeatureIds].map((featureId) => {
          const meta = FEATURE_META[featureId];
          const local = localFeatures[featureId];
          const autumn = autumnData?.[featureId];
          const Icon = meta?.icon ?? FileText;
          const label = meta?.label ?? featureId;
          const description = meta?.description ?? '';

          const autumnCustomerFeature = customer?.features[featureId];
          const isAvailable = autumnCustomerFeature
            ? (autumnCustomerFeature.unlimited === true || (autumnCustomerFeature.balance ?? 0) > 0)
            : true;
          const autumnBalance = autumnCustomerFeature?.balance ?? null;
          const isUnlimited = autumnCustomerFeature?.unlimited === true;

          return (
            <Card key={featureId}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <div className="flex items-center gap-2">
                    <Icon className="size-4" />
                    {label}
                  </div>
                  {autumnCustomerFeature && (
                    isUnlimited ? (
                      <Badge variant="secondary" className="text-[10px]">Unlimited</Badge>
                    ) : isAvailable ? (
                      <Badge variant="outline" className="border-green-500/50 text-[10px] text-green-600 dark:text-green-400">
                        {autumnBalance} left
                      </Badge>
                    ) : (
                      <Badge variant="destructive" className="text-[10px]">Limit reached</Badge>
                    )
                  )}
                </CardTitle>
                {description && (
                  <p className="text-muted-foreground text-xs">{description}</p>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs font-medium">
                    Local (Convex)
                  </div>
                  {local ? (
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs">Balance</div>
                        <div className="font-mono font-semibold">{local.balance}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Used</div>
                        <div className="font-mono">{local.used}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Included</div>
                        <div className="font-mono">{local.included}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs italic">Not synced yet</p>
                  )}
                </div>

                {autumn && (
                  <div className="space-y-1">
                    <div className="text-muted-foreground text-xs font-medium">
                      Autumn (Live)
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-muted-foreground text-xs">Balance</div>
                        <div className="font-mono font-semibold">{autumn.balance}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Used</div>
                        <div className="font-mono">{autumn.used}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground text-xs">Included</div>
                        <div className="font-mono">{autumn.included}</div>
                      </div>
                    </div>
                    <div className="flex gap-2 text-xs">
                      {autumn.unlimited && (
                        <Badge variant="secondary" className="text-[10px]">Unlimited</Badge>
                      )}
                      {autumn.interval && (
                        <Badge variant="outline" className="text-[10px]">{autumn.interval}</Badge>
                      )}
                    </div>
                  </div>
                )}

                {local && autumn && (
                  <DiffIndicator local={local} autumn={autumn} />
                )}

                {meta && (
                  <SimulateButton
                    featureId={featureId}
                    label={label}
                    loading={loading}
                    isAvailable={isAvailable}
                    onSimulate={handleSimulate}
                    onUpgrade={handleUpgrade}
                    simulateChat={simulateChat}
                    simulateSentence={simulateSentence}
                    simulateCustom={simulateCustom}
                    simulateCourse={simulateCourse}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">How It Works</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground space-y-2 text-sm">
          <p>
            <strong>1. Sync from Autumn</strong> fetches the customer object (single API call)
            and writes all features to one local Convex document.
          </p>
          <p>
            <strong>2. Simulate</strong> buttons run a mutation that checks the local quota,
            decrements it, and schedules an async <code className="text-xs">trackUsage</code> action.
            When the limit is reached, the upgrade dialog opens automatically.
          </p>
          <p>
            <strong>3. Fetch Autumn Live</strong> queries Autumn directly for comparison.
          </p>
          <p>
            <strong>4. Reset Local</strong> deletes the local quota document.
          </p>
          <p>
            <strong>5. Availability badges</strong> on each card reflect live Autumn balances via{' '}
            <code className="text-xs">useCustomer()</code> — visible before you click anything.
          </p>
        </CardContent>
      </Card>

      <PaywallDialog
        open={paywallFeatureId !== null}
        setOpen={(open) => { if (!open) setPaywallFeatureId(null); }}
        featureId={paywallFeatureId ?? ''}
      />
    </div>
  );
}

function DiffIndicator({ local, autumn }: { local: FeatureState; autumn: FeatureState }) {
  const balanceDiff = local.balance - autumn.balance;
  const usedDiff = local.used - autumn.used;

  if (balanceDiff === 0 && usedDiff === 0) {
    return <div className="text-xs text-green-600 dark:text-green-400">In sync</div>;
  }

  return (
    <div className="text-xs text-amber-600 dark:text-amber-400">
      Drift: balance {balanceDiff > 0 ? '+' : ''}{balanceDiff}, used {usedDiff > 0 ? '+' : ''}{usedDiff}
    </div>
  );
}

function SimulateButton({
  featureId,
  label,
  loading,
  isAvailable,
  onSimulate,
  onUpgrade,
  simulateChat,
  simulateSentence,
  simulateCustom,
  simulateCourse,
}: {
  featureId: string;
  label: string;
  loading: string | null;
  isAvailable: boolean;
  onSimulate: (feature: string, fn: () => Promise<{ allowed: boolean; balance: number }>) => void;
  onUpgrade: (featureId: string) => void;
  simulateChat: () => Promise<{ allowed: boolean; balance: number }>;
  simulateSentence: (args: { count?: number }) => Promise<{ allowed: boolean; balance: number }>;
  simulateCustom: () => Promise<{ allowed: boolean; balance: number }>;
  simulateCourse: () => Promise<{ allowed: boolean; balance: number }>;
}) {
  const isLoading = loading === featureId;

  const simulateHandler = () => {
    switch (featureId) {
      case 'chat_messages':
        return onSimulate(featureId, simulateChat);
      case 'sentences':
        return onSimulate(featureId, () => simulateSentence({}));
      case 'custom_sentences':
        return onSimulate(featureId, simulateCustom);
      case 'courses':
        return onSimulate(featureId, simulateCourse);
    }
  };

  if (!isAvailable) {
    return (
      <div className="flex flex-col space-y-2 py-2">
      <Button
        variant="outline"
        size="sm"
        className="w-full border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
        onClick={() => onUpgrade(featureId)}
        disabled={loading !== null}
      >
        <Lock className="size-3.5" />
        Upgrade to use {label}
      </Button>

      <p className='text-xs text-amber-600 dark:text-amber-400'> Button without client Autumn check </p> 

      <Button variant="secondary" size="sm" className="w-full" onClick={simulateHandler} disabled={loading !== null}>
        {isLoading && <Loader2 className="animate-spin" />}
        Use 1 {label}
      </Button>
      </div>
    );
  }

  return (
    <Button variant="secondary" size="sm" className="w-full" onClick={simulateHandler} disabled={loading !== null}>
      {isLoading && <Loader2 className="animate-spin" />}
      Use 1 {label}
    </Button>
  );
}
