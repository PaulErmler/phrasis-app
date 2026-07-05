/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin_activateDataset from "../admin/activateDataset.js";
import type * as admin_backfillCollectionOrigin from "../admin/backfillCollectionOrigin.js";
import type * as admin_backfillTextMetadata from "../admin/backfillTextMetadata.js";
import type * as admin_dashboard from "../admin/dashboard.js";
import type * as admin_diagCutoverState from "../admin/diagCutoverState.js";
import type * as admin_lib from "../admin/lib.js";
import type * as admin_manage from "../admin/manage.js";
import type * as admin_uploadDataset from "../admin/uploadDataset.js";
import type * as admin_userContent from "../admin/userContent.js";
import type * as admin_warmupCourseLevels from "../admin/warmupCourseLevels.js";
import type * as admin_warmupPlacementTranslations from "../admin/warmupPlacementTranslations.js";
import type * as admin_warmupSingleLanguage from "../admin/warmupSingleLanguage.js";
import type * as auth from "../auth.js";
import type * as autumn from "../autumn.js";
import type * as billing from "../billing.js";
import type * as config_aiModels from "../config/aiModels.js";
import type * as db_collections from "../db/collections.js";
import type * as db_courseSettings from "../db/courseSettings.js";
import type * as db_courseStats from "../db/courseStats.js";
import type * as db_courses from "../db/courses.js";
import type * as db_decks from "../db/decks.js";
import type * as db_reviewLogs from "../db/reviewLogs.js";
import type * as db_seed from "../db/seed.js";
import type * as db_stats_cardAggregates from "../db/stats/cardAggregates.js";
import type * as db_stats_dailyLanguageStats from "../db/stats/dailyLanguageStats.js";
import type * as db_stats_dailyStats from "../db/stats/dailyStats.js";
import type * as db_stats_languageStats from "../db/stats/languageStats.js";
import type * as db_stats_monthlyStats from "../db/stats/monthlyStats.js";
import type * as db_stats_recordRadioPlayStats from "../db/stats/recordRadioPlayStats.js";
import type * as db_stats_recordReviewStats from "../db/stats/recordReviewStats.js";
import type * as db_stats_reverseReviewStats from "../db/stats/reverseReviewStats.js";
import type * as db_stats_reviewDepthAccuracy from "../db/stats/reviewDepthAccuracy.js";
import type * as db_stats_weeklyStats from "../db/stats/weeklyStats.js";
import type * as db_stats_wordTracking from "../db/stats/wordTracking.js";
import type * as db_stats_yearlyStats from "../db/stats/yearlyStats.js";
import type * as db_translationSeed from "../db/translationSeed.js";
import type * as db_userProfiles from "../db/userProfiles.js";
import type * as db_users from "../db/users.js";
import type * as features_chat_agent from "../features/chat/agent.js";
import type * as features_chat_cardApprovals from "../features/chat/cardApprovals.js";
import type * as features_chat_constants from "../features/chat/constants.js";
import type * as features_chat_messages from "../features/chat/messages.js";
import type * as features_chat_threads from "../features/chat/threads.js";
import type * as features_chat_transcribe from "../features/chat/transcribe.js";
import type * as features_collections from "../features/collections.js";
import type * as features_courses from "../features/courses.js";
import type * as features_customTexts from "../features/customTexts.js";
import type * as features_decks from "../features/decks.js";
import type * as features_featureIds from "../features/featureIds.js";
import type * as features_home from "../features/home.js";
import type * as features_library from "../features/library.js";
import type * as features_llmTranslationQueue from "../features/llmTranslationQueue.js";
import type * as features_onboarding from "../features/onboarding.js";
import type * as features_placementTest from "../features/placementTest.js";
import type * as features_scheduling from "../features/scheduling.js";
import type * as features_sentenceMetadata from "../features/sentenceMetadata.js";
import type * as features_stats from "../features/stats.js";
import type * as features_translation from "../features/translation.js";
import type * as features_translationLLM from "../features/translationLLM.js";
import type * as features_tts from "../features/tts.js";
import type * as features_ttsProcessing from "../features/ttsProcessing.js";
import type * as features_tutorialIds from "../features/tutorialIds.js";
import type * as http from "../http.js";
import type * as lib_audio from "../lib/audio.js";
import type * as lib_cardContent from "../lib/cardContent.js";
import type * as lib_collections from "../lib/collections.js";
import type * as lib_dateUtils from "../lib/dateUtils.js";
import type * as lib_fsrsStates from "../lib/fsrsStates.js";
import type * as lib_localRomanization from "../lib/localRomanization.js";
import type * as lib_queuePump from "../lib/queuePump.js";
import type * as lib_stt_azure from "../lib/stt/azure.js";
import type * as lib_stt_index from "../lib/stt/index.js";
import type * as lib_stt_languageCodes from "../lib/stt/languageCodes.js";
import type * as lib_textComparison from "../lib/textComparison.js";
import type * as lib_tts_azure from "../lib/tts/azure.js";
import type * as lib_tts_gemini from "../lib/tts/gemini.js";
import type * as lib_tts_google from "../lib/tts/google.js";
import type * as lib_tts_index from "../lib/tts/index.js";
import type * as lib_tts_languageCodes from "../lib/tts/languageCodes.js";
import type * as lib_tts_tailTrim from "../lib/tts/tailTrim.js";
import type * as lib_tts_types from "../lib/tts/types.js";
import type * as lib_ttsSemanticValidation from "../lib/ttsSemanticValidation.js";
import type * as migrations_backfillContentVersions from "../migrations/backfillContentVersions.js";
import type * as migrations_backfillPlanNames from "../migrations/backfillPlanNames.js";
import type * as migrations_backfillUserProfiles from "../migrations/backfillUserProfiles.js";
import type * as migrations_datasetMigration_backfillCardsMastered from "../migrations/datasetMigration_backfillCardsMastered.js";
import type * as migrations_datasetMigration_backfillLegacyCarry from "../migrations/datasetMigration_backfillLegacyCarry.js";
import type * as migrations_datasetMigration_cutoverUser from "../migrations/datasetMigration_cutoverUser.js";
import type * as migrations_recalcUserCardAggregates from "../migrations/recalcUserCardAggregates.js";
import type * as migrations_recleanGeminiTailHiccup from "../migrations/recleanGeminiTailHiccup.js";
import type * as migrations_recleanGeminiTailHiccupNode from "../migrations/recleanGeminiTailHiccupNode.js";
import type * as migrations_seedMockStats from "../migrations/seedMockStats.js";
import type * as migrations_seedPlacementTestSentences from "../migrations/seedPlacementTestSentences.js";
import type * as rateLimiter from "../rateLimiter.js";
import type * as retrier from "../retrier.js";
import type * as types from "../types.js";
import type * as usage_actions from "../usage/actions.js";
import type * as usage_helpers from "../usage/helpers.js";
import type * as usage_queries from "../usage/queries.js";
import type * as usage_tracking from "../usage/tracking.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/activateDataset": typeof admin_activateDataset;
  "admin/backfillCollectionOrigin": typeof admin_backfillCollectionOrigin;
  "admin/backfillTextMetadata": typeof admin_backfillTextMetadata;
  "admin/dashboard": typeof admin_dashboard;
  "admin/diagCutoverState": typeof admin_diagCutoverState;
  "admin/lib": typeof admin_lib;
  "admin/manage": typeof admin_manage;
  "admin/uploadDataset": typeof admin_uploadDataset;
  "admin/userContent": typeof admin_userContent;
  "admin/warmupCourseLevels": typeof admin_warmupCourseLevels;
  "admin/warmupPlacementTranslations": typeof admin_warmupPlacementTranslations;
  "admin/warmupSingleLanguage": typeof admin_warmupSingleLanguage;
  auth: typeof auth;
  autumn: typeof autumn;
  billing: typeof billing;
  "config/aiModels": typeof config_aiModels;
  "db/collections": typeof db_collections;
  "db/courseSettings": typeof db_courseSettings;
  "db/courseStats": typeof db_courseStats;
  "db/courses": typeof db_courses;
  "db/decks": typeof db_decks;
  "db/reviewLogs": typeof db_reviewLogs;
  "db/seed": typeof db_seed;
  "db/stats/cardAggregates": typeof db_stats_cardAggregates;
  "db/stats/dailyLanguageStats": typeof db_stats_dailyLanguageStats;
  "db/stats/dailyStats": typeof db_stats_dailyStats;
  "db/stats/languageStats": typeof db_stats_languageStats;
  "db/stats/monthlyStats": typeof db_stats_monthlyStats;
  "db/stats/recordRadioPlayStats": typeof db_stats_recordRadioPlayStats;
  "db/stats/recordReviewStats": typeof db_stats_recordReviewStats;
  "db/stats/reverseReviewStats": typeof db_stats_reverseReviewStats;
  "db/stats/reviewDepthAccuracy": typeof db_stats_reviewDepthAccuracy;
  "db/stats/weeklyStats": typeof db_stats_weeklyStats;
  "db/stats/wordTracking": typeof db_stats_wordTracking;
  "db/stats/yearlyStats": typeof db_stats_yearlyStats;
  "db/translationSeed": typeof db_translationSeed;
  "db/userProfiles": typeof db_userProfiles;
  "db/users": typeof db_users;
  "features/chat/agent": typeof features_chat_agent;
  "features/chat/cardApprovals": typeof features_chat_cardApprovals;
  "features/chat/constants": typeof features_chat_constants;
  "features/chat/messages": typeof features_chat_messages;
  "features/chat/threads": typeof features_chat_threads;
  "features/chat/transcribe": typeof features_chat_transcribe;
  "features/collections": typeof features_collections;
  "features/courses": typeof features_courses;
  "features/customTexts": typeof features_customTexts;
  "features/decks": typeof features_decks;
  "features/featureIds": typeof features_featureIds;
  "features/home": typeof features_home;
  "features/library": typeof features_library;
  "features/llmTranslationQueue": typeof features_llmTranslationQueue;
  "features/onboarding": typeof features_onboarding;
  "features/placementTest": typeof features_placementTest;
  "features/scheduling": typeof features_scheduling;
  "features/sentenceMetadata": typeof features_sentenceMetadata;
  "features/stats": typeof features_stats;
  "features/translation": typeof features_translation;
  "features/translationLLM": typeof features_translationLLM;
  "features/tts": typeof features_tts;
  "features/ttsProcessing": typeof features_ttsProcessing;
  "features/tutorialIds": typeof features_tutorialIds;
  http: typeof http;
  "lib/audio": typeof lib_audio;
  "lib/cardContent": typeof lib_cardContent;
  "lib/collections": typeof lib_collections;
  "lib/dateUtils": typeof lib_dateUtils;
  "lib/fsrsStates": typeof lib_fsrsStates;
  "lib/localRomanization": typeof lib_localRomanization;
  "lib/queuePump": typeof lib_queuePump;
  "lib/stt/azure": typeof lib_stt_azure;
  "lib/stt/index": typeof lib_stt_index;
  "lib/stt/languageCodes": typeof lib_stt_languageCodes;
  "lib/textComparison": typeof lib_textComparison;
  "lib/tts/azure": typeof lib_tts_azure;
  "lib/tts/gemini": typeof lib_tts_gemini;
  "lib/tts/google": typeof lib_tts_google;
  "lib/tts/index": typeof lib_tts_index;
  "lib/tts/languageCodes": typeof lib_tts_languageCodes;
  "lib/tts/tailTrim": typeof lib_tts_tailTrim;
  "lib/tts/types": typeof lib_tts_types;
  "lib/ttsSemanticValidation": typeof lib_ttsSemanticValidation;
  "migrations/backfillContentVersions": typeof migrations_backfillContentVersions;
  "migrations/backfillPlanNames": typeof migrations_backfillPlanNames;
  "migrations/backfillUserProfiles": typeof migrations_backfillUserProfiles;
  "migrations/datasetMigration_backfillCardsMastered": typeof migrations_datasetMigration_backfillCardsMastered;
  "migrations/datasetMigration_backfillLegacyCarry": typeof migrations_datasetMigration_backfillLegacyCarry;
  "migrations/datasetMigration_cutoverUser": typeof migrations_datasetMigration_cutoverUser;
  "migrations/recalcUserCardAggregates": typeof migrations_recalcUserCardAggregates;
  "migrations/recleanGeminiTailHiccup": typeof migrations_recleanGeminiTailHiccup;
  "migrations/recleanGeminiTailHiccupNode": typeof migrations_recleanGeminiTailHiccupNode;
  "migrations/seedMockStats": typeof migrations_seedMockStats;
  "migrations/seedPlacementTestSentences": typeof migrations_seedPlacementTestSentences;
  rateLimiter: typeof rateLimiter;
  retrier: typeof retrier;
  types: typeof types;
  "usage/actions": typeof usage_actions;
  "usage/helpers": typeof usage_helpers;
  "usage/queries": typeof usage_queries;
  "usage/tracking": typeof usage_tracking;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  autumn: import("@useautumn/convex/_generated/component.js").ComponentApi<"autumn">;
  cardsByState: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"cardsByState">;
  cardsByDueDate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"cardsByDueDate">;
  cardsByStateAndDueDate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"cardsByStateAndDueDate">;
  actionRetrier: import("@convex-dev/action-retrier/_generated/component.js").ComponentApi<"actionRetrier">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
