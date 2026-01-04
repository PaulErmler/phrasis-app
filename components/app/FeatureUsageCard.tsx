"use client";

import { useState, useEffect } from "react";
import { useCustomer, CheckoutDialog } from "autumn-js/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Gauge, Zap, Check, X, Loader2, AlertCircle, Database, RefreshCw, Clock } from "lucide-react";
import {
  Alert,
  AlertDescription,
} from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";

// Types
interface Feature {
  balance?: number;
  usage?: number;
  unlimited?: boolean;
  included?: boolean;
}

// Utility functions
const formatFeatureName = (featureId: string): string => {
  return featureId
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const isUsageFeature = (feature: Feature): boolean => {
  return feature.balance !== undefined || feature.usage !== undefined;
};

const getUsagePercentage = (feature: Feature): number => {
  if (feature.unlimited) return 0;
  if (feature.balance === undefined) return 0;
  const usage = feature.usage ?? 0;
  const total = usage + feature.balance;
  if (total === 0) return 0;
  return Math.round((usage / total) * 100);
};

// Sub-components
function LoadingCard({ description }: { description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Gauge className="h-5 w-5" />
          Feature Usage
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

interface UsageFeatureContentProps {
  featureId: string;
  feature: Feature;
  isLoading: boolean;
  isExhausted: boolean;
  onUseFeature: (featureId: string) => void;
}

function UsageFeatureContent({
  featureId,
  feature,
  isLoading,
  isExhausted,
  onUseFeature,
}: UsageFeatureContentProps) {
  return (
    <>
      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {feature.unlimited ? (
              "Unlimited"
            ) : (
              <>
                {feature.usage ?? 0} used / {(feature.usage ?? 0) + (feature.balance ?? 0)} total
              </>
            )}
          </span>
          <span className="font-medium">
            {feature.unlimited ? "∞" : `${feature.balance ?? 0} remaining`}
          </span>
        </div>
        {!feature.unlimited && (
          <Progress value={getUsagePercentage(feature)} className="h-2" />
        )}
      </div>

      {/* Exhausted Alert */}
      {isExhausted && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Feature limit reached. No remaining balance available.
          </AlertDescription>
        </Alert>
      )}

      {/* Use Feature Button */}
      <Button
        size="sm"
        variant={isExhausted ? "destructive" : "default"}
        onClick={() => onUseFeature(featureId)}
        disabled={isLoading}
        className="w-full"
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Zap className="h-4 w-4" />
        )}
        {isExhausted ? "Upgrade to Use" : "Use Feature"}
      </Button>
    </>
  );
}

interface FeatureItemProps {
  featureId: string;
  feature: Feature;
  isLoading: boolean;
  isExhausted: boolean;
  onUseFeature: (featureId: string) => void;
}

function FeatureItem({
  featureId,
  feature,
  isLoading,
  isExhausted,
  onUseFeature,
}: FeatureItemProps) {
  const isUsage = isUsageFeature(feature);

  return (
    <div className="rounded-lg border p-4 space-y-3">
      {/* Feature Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium">{formatFeatureName(featureId)}</span>
          {isUsage ? (
            <Badge variant="secondary" className="text-xs">
              Usage
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs">
              Boolean
            </Badge>
          )}
        </div>

        {/* Boolean Feature Status */}
        {!isUsage && (
          <Badge variant={feature.included ? "default" : "destructive"}>
            {feature.included ? (
              <>
                <Check className="h-3 w-3" />
                Enabled
              </>
            ) : (
              <>
                <X className="h-3 w-3" />
                Disabled
              </>
            )}
          </Badge>
        )}
      </div>

      {/* Usage Feature Details */}
      {isUsage && (
        <UsageFeatureContent
          featureId={featureId}
          feature={feature}
          isLoading={isLoading}
          isExhausted={isExhausted}
          onUseFeature={onUseFeature}
        />
      )}

      {/* Boolean Feature - Upgrade Button */}
      {!isUsage && !feature.included && (
        <Button
          size="sm"
          variant="default"
          onClick={() => onUseFeature(featureId)}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Zap className="h-4 w-4" />
          )}
          Upgrade to Access
        </Button>
      )}
    </div>
  );
}

// Format timestamp for display
const formatLastSynced = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

// Cached quota display component
interface CachedQuotaDisplayProps {
  cachedFeatures: Record<string, Feature> | null;
  lastSyncedAt: number | null;
  onSync: () => void;
  isSyncing: boolean;
}

function CachedQuotaDisplay({ 
  cachedFeatures, 
  lastSyncedAt, 
  onSync, 
  isSyncing 
}: CachedQuotaDisplayProps) {
  if (!cachedFeatures) {
    return (
      <div className="rounded-lg border border-dashed p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Database className="h-4 w-4" />
            <span className="text-sm">Local cache not available</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={onSync}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Sync Now
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Cached Quota (Convex)</span>
        </div>
        <div className="flex items-center gap-2">
          {lastSyncedAt && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatLastSynced(lastSyncedAt)}
            </span>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onSync}
            disabled={isSyncing}
            className="h-7 px-2"
          >
            {isSyncing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>
      
      <div className="grid gap-2">
        {Object.entries(cachedFeatures).map(([featureId, feature]) => {
          const isUsage = isUsageFeature(feature);
          
          return (
            <div 
              key={featureId}
              className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-muted/50"
            >
              <span className="text-muted-foreground">
                {formatFeatureName(featureId)}
              </span>
              <span className="font-mono text-xs">
                {feature.unlimited ? (
                  <Badge variant="secondary" className="text-xs">∞</Badge>
                ) : feature.included !== undefined ? (
                  <Badge variant={feature.included ? "default" : "secondary"} className="text-xs">
                    {feature.included ? "Yes" : "No"}
                  </Badge>
                ) : isUsage ? (
                  <span className={feature.balance === 0 ? "text-destructive" : ""}>
                    {feature.balance ?? 0} left
                  </span>
                ) : (
                  "—"
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Main component
export function FeatureUsageCard() {
  const { data: session, isPending: isSessionPending } = authClient.useSession();
  const { customer, attach, refetch } = useCustomer();
  const [loadingFeature, setLoadingFeature] = useState<string | null>(null);
  const [exhaustedFeatures, setExhaustedFeatures] = useState<Set<string>>(new Set());
  const [isInitialized, setIsInitialized] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  // Convex mutation for secure server-side feature usage
  const useFeatureMutation = useMutation(api.features.useFeature);
  
  // Convex action for syncing features (fallback/manual refresh)
  const syncFeatures = useAction(api.features.triggerSyncFeatures);
  
  // Convex query for cached features
  const cachedFeaturesData = useQuery(api.features.getUserFeatures);

  // Force re-initialization when session changes
  useEffect(() => {
    if (session?.user) {
      setIsInitialized(true);
      refetch?.();
    } else {
      setIsInitialized(false);
    }
  }, [session?.user?.id, refetch]);

  // Handler to manually sync features
  const handleSyncFeatures = async () => {
    setIsSyncing(true);
    try {
      const result = await syncFeatures();
      if (result.success) {
        toast.success("Features synced successfully");
        await refetch?.();
      } else {
        toast.error("Failed to sync features", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Sync error:", error);
      toast.error("Failed to sync features");
    } finally {
      setIsSyncing(false);
    }
  };

  // Loading states
  if (isSessionPending) {
    return <LoadingCard description="Checking authentication..." />;
  }

  if (!session?.user) {
    return null;
  }

  if (!customer || !isInitialized) {
    return <LoadingCard description="Loading your plan features..." />;
  }

  const features = customer.features as Record<string, Feature> | undefined;

  if (!features || Object.keys(features).length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Gauge className="h-5 w-5" />
            Feature Usage
          </CardTitle>
          <CardDescription>No features configured for your plan</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // Handler - secure server-side feature usage
  const handleUseFeature = async (featureId: string, value?: number) => {
    setLoadingFeature(featureId);
    try {
      const result = await useFeatureMutation({ featureId, value });
      
      if (result.used) {
        toast.success(`Feature "${formatFeatureName(featureId)}" used successfully!`);
        await refetch?.();
        return;
      }

      if (!result.allowed) {
        // Check the reason for not being allowed
        const isLimitReached = result.message === "Feature limit reached";
        const needsSync = result.message?.includes("not synced");
        const notFound = result.message?.includes("not found");
        
        if (needsSync) {
          // Features haven't synced yet - trigger sync and inform user
          toast.info("Syncing features...", {
            description: "Please wait while we sync your plan features.",
          });
          await syncFeatures();
          await refetch?.();
          return;
        }
        
        if (notFound) {
          // Feature not configured for this plan
          toast.error("Feature not available", {
            description: result.message,
          });
          return;
        }
        
        if (isLimitReached) {
          // Feature limit actually reached - show upgrade dialog
          try {
            const attachResult = await attach({
              productId: "pro",
              dialog: CheckoutDialog
            });

            const attachData = attachResult && 'data' in attachResult ? attachResult.data : attachResult;
            const hasCheckoutUrl = attachData && typeof attachData === 'object' && 'checkout_url' in attachData && attachData.checkout_url;

            if (!hasCheckoutUrl) {
              setExhaustedFeatures(prev => new Set(prev).add(featureId));
              toast.error("Feature limit reached", {
                description: result.message || "You've exhausted this feature on your current plan.",
              });
            }
          } catch {
            setExhaustedFeatures(prev => new Set(prev).add(featureId));
            toast.error("Feature limit reached", {
              description: result.message || "You've exhausted this feature on your current plan.",
            });
          }
          return;
        }
        
        // Unknown reason - show error
        toast.error("Cannot use feature", {
          description: result.message,
        });
      } else {
        // Allowed but failed to use
        toast.error("Failed to use feature", {
          description: result.message,
        });
      }
    } catch (error) {
      console.error("Use feature error:", error);
      toast.error("Failed to use feature");
    } finally {
      setLoadingFeature(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Gauge className="h-5 w-5" />
          Feature Usage
        </CardTitle>
        <CardDescription>
          Your current plan features and usage
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Autumn features (real-time) */}
        {Object.entries(features).map(([featureId, feature]) => {
          const isUsage = isUsageFeature(feature);
          const isExhausted = exhaustedFeatures.has(featureId) ||
            (isUsage && !feature.unlimited && (feature.balance ?? 0) === 0);

          return (
            <FeatureItem
              key={featureId}
              featureId={featureId}
              feature={feature}
              isLoading={loadingFeature === featureId}
              isExhausted={isExhausted}
              onUseFeature={handleUseFeature}
            />
          );
        })}
        
        {/* Separator */}
        <Separator className="my-4" />
        
        {/* Cached quota from Convex */}
        <CachedQuotaDisplay
          cachedFeatures={cachedFeaturesData?.features ?? null}
          lastSyncedAt={cachedFeaturesData?.lastSyncedAt ?? null}
          onSync={handleSyncFeatures}
          isSyncing={isSyncing}
        />
      </CardContent>
    </Card>
  );
}
