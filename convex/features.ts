import { v } from "convex/values";
import { 
  action, 
  internalAction, 
  internalMutation, 
  mutation, 
  query,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { autumn } from "./autumn";

// Feature IDs
const FEATURE_IDS = {
  CHAT_MESSAGES: "chat_messages",
  COURSES: "courses",
  REVIEWS: "reviews",
  CUSTOM_PHRASES: "custom_phrases",
} as const;

// Type for Autumn feature data (matches Autumn API response)
interface AutumnFeature {
  feature_id: string;
  // Metered feature fields (optional - not present for boolean features)
  included_usage?: number;
  usage?: number;
  balance?: number;
  unlimited?: boolean;
  interval?: string;
  next_reset_at?: number | null;
  // Boolean features only have feature_id (presence in array means enabled)
}

// Helper to convert Autumn features array to record keyed by feature_id
function featuresToRecord(features: AutumnFeature[]): Record<string, AutumnFeature> {
  const record: Record<string, AutumnFeature> = {};
  for (const feature of features) {
    if (feature.feature_id) {
      record[feature.feature_id] = feature;
    }
  }
  return record;
}

// Helper to check if a feature is a boolean feature (only has feature_id)
function isBooleanFeature(feature: AutumnFeature): boolean {
  return feature.balance === undefined && 
         feature.usage === undefined && 
         feature.unlimited === undefined;
}

// Helper to get authenticated user ID (for queries/mutations)
async function getAuthenticatedUserId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("Not authenticated");
  }
  return identity.subject;
}

// ============================================
// Feature Caching System
// Allows checking access in queries/mutations
// ============================================

/**
 * Sync features from Autumn and cache in Convex
 * Call this on page load to keep cache fresh
 */
export const triggerSyncFeatures = action({
  args: {},
  returns: v.object({
    success: v.boolean(),
    message: v.optional(v.string()),
  }),
  handler: async (ctx, _args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { 
        success: false, 
        message: "Not authenticated",
      };
    }
    
    try {
      await ctx.runAction(internal.features.syncFeaturesInternal, {
        userId: identity.subject,
      });
      return { 
        success: true, 
        message: "Features synced successfully",
      };
    } catch (error) {
      console.error("Failed to sync features:", error);
      return { 
        success: false, 
        message: "Failed to fetch features from Autumn",
      };
    }
  },
});

/**
 * Internal mutation to store/update cached features
 */
export const upsertUserFeatures = internalMutation({
  args: {
    userId: v.string(),
    features: v.any(), // Using v.any() since Autumn returns many fields
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userFeatures")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    
    if (existing) {
      await ctx.db.patch(existing._id, {
        features: args.features,
        lastSyncedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("userFeatures", {
        userId: args.userId,
        features: args.features,
        lastSyncedAt: Date.now(),
      });
    }
    
    return null;
  },
});

/**
 * Internal action to sync features from Autumn and cache in Convex
 * Can be called from other internal actions (e.g., after tracking usage)
 * Uses REST API since scheduled actions don't have auth context
 */
export const syncFeaturesInternal = internalAction({
  args: {
    userId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const secretKey = process.env.AUTUMN_SECRET_KEY;
    if (!secretKey) {
      console.error("AUTUMN_SECRET_KEY not configured");
      return null;
    }
    
    try {
      // Get customer data via REST API (scheduled actions don't have auth context)
      const response = await fetch(
        `https://api.useautumn.com/v1/customers/${encodeURIComponent(args.userId)}`,
        {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${secretKey}`,
            "Content-Type": "application/json",
          },
        }
      );
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch customer ${args.userId}:`, response.status, errorText);
        return null;
      }
      
      const customer = await response.json();
      
      if (!customer.features) {
        console.error(`No features found for user ${args.userId}`);
        return null;
      }
      
      // Convert features array to record keyed by feature_id
      const customerFeatures = customer.features;
      const features = Array.isArray(customerFeatures) 
        ? featuresToRecord(customerFeatures as AutumnFeature[])
        : customerFeatures as Record<string, AutumnFeature>;
      
      await ctx.runMutation(internal.features.upsertUserFeatures, {
        userId: args.userId,
        features,
      });
    } catch (error) {
      console.error(`Failed to sync features for user ${args.userId}:`, error);
    }
    
    return null;
  },
});

/**
 * Query to get cached features for display
 */
export const getUserFeatures = query({
  args: {},
  returns: v.union(
    v.object({
      features: v.any(), // Using v.any() since Autumn returns many fields
      lastSyncedAt: v.number(),
    }),
    v.null()
  ),
  handler: async (ctx, _args) => {
    const userId = await getAuthenticatedUserId(ctx);
    
    const userFeatures = await ctx.db
      .query("userFeatures")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    
    if (!userFeatures) {
      return null;
    }
    
    return {
      features: userFeatures.features as Record<string, AutumnFeature>,
      lastSyncedAt: userFeatures.lastSyncedAt,
    };
  },
});

/**
 * Use a feature - checks local cache, decrements balance, schedules async tracking
 * This mutation can be called from other mutations/queries for access control
 */
export const useFeature = mutation({
  args: {
    featureId: v.string(),
    value: v.optional(v.number()), // Amount to use, defaults to 1
  },
  returns: v.object({
    allowed: v.boolean(),
    used: v.boolean(),
    message: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthenticatedUserId(ctx);
    const value = args.value ?? 1;
    
    // Get cached features
    const userFeatures = await ctx.db
      .query("userFeatures")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    
    if (!userFeatures) {
      return { 
        allowed: false, 
        used: false, 
        message: "Features not synced yet. Please wait for sync to complete.",
      };
    }
    
    const features = userFeatures.features as Record<string, AutumnFeature>;
    const feature = features[args.featureId];
    
    if (!feature) {
      return { 
        allowed: false, 
        used: false, 
        message: "Feature not found in your plan",
      };
    }
    
    // Check if feature is a boolean feature (only has feature_id, no balance/usage)
    // Boolean features being present in the record means they're enabled
    if (isBooleanFeature(feature)) {
      // Boolean feature is present = included, no tracking needed
      return { 
        allowed: true, 
        used: true, 
        message: "Feature access granted",
      };
    }
    
    // Check if unlimited
    if (feature.unlimited) {
      // Schedule async tracking with the specified value
      await ctx.scheduler.runAfter(0, internal.features.trackFeatureUsage, {
        userId,
        featureId: args.featureId,
        value,
      });
      
      return { 
        allowed: true, 
        used: true, 
        message: "Feature used (unlimited)",
      };
    }
    
    // Check balance for usage-based features
    const balance = feature.balance ?? 0;
    
    if (balance < value) {
      return { 
        allowed: false, 
        used: false, 
        message: "Feature limit reached",
      };
    }
    
    // Pessimistically decrement balance locally by the specified value
    const updatedFeatures = { ...features };
    updatedFeatures[args.featureId] = {
      ...feature,
      balance: balance - value,
      usage: (feature.usage ?? 0) + value,
    };
    
    await ctx.db.patch(userFeatures._id, {
      features: updatedFeatures,
    });
    
    // Schedule async tracking with Autumn using the specified value
    await ctx.scheduler.runAfter(0, internal.features.trackFeatureUsage, {
      userId,
      featureId: args.featureId,
      value,
    });
    
    return { 
      allowed: true, 
      used: true, 
      message: "Feature used successfully",
    };
  },
});

/**
 * Internal action to track feature usage with Autumn
 * This runs asynchronously after the mutation
 * After tracking, syncs features to update local cache with authoritative data
 * Uses REST API since scheduled actions don't have auth context
 */
export const trackFeatureUsage = internalAction({
  args: {
    userId: v.string(),
    featureId: v.string(),
    value: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const secretKey = process.env.AUTUMN_SECRET_KEY;
    if (!secretKey) {
      console.error("AUTUMN_SECRET_KEY not configured");
      return null;
    }
    
    try {
      // Track usage via REST API (scheduled actions don't have auth context)
      const response = await fetch("https://api.useautumn.com/v1/track", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer_id: args.userId,
          feature_id: args.featureId,
          value: args.value,
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `Failed to track feature usage for user ${args.userId}, feature ${args.featureId}:`,
          response.status,
          errorText
        );
      }
      
      // Sync features after tracking to update local cache with authoritative data
      await ctx.runAction(internal.features.syncFeaturesInternal, {
        userId: args.userId,
      });
    } catch (error) {
      // Log error but don't fail - the local balance was already decremented
      console.error(
        `Failed to track feature usage for user ${args.userId}, feature ${args.featureId}:`,
        error
      );
    }
    
    return null;
  },
});

