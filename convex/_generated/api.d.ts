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
import type * as admin_backfillIpa from "../admin/backfillIpa.js";
import type * as admin_cardEdits from "../admin/cardEdits.js";
import type * as admin_dashboard from "../admin/dashboard.js";
import type * as admin_deleteUser from "../admin/deleteUser.js";
import type * as admin_lib from "../admin/lib.js";
import type * as admin_manage from "../admin/manage.js";
import type * as admin_uploadDataset from "../admin/uploadDataset.js";
import type * as admin_userContent from "../admin/userContent.js";
import type * as admin_warmupCourseLevels from "../admin/warmupCourseLevels.js";
import type * as admin_warmupLanguages from "../admin/warmupLanguages.js";
import type * as admin_warmupPlacementTranslations from "../admin/warmupPlacementTranslations.js";
import type * as admin_warmupSingleLanguage from "../admin/warmupSingleLanguage.js";
import type * as analytics from "../analytics.js";
import type * as auth from "../auth.js";
import type * as autumn from "../autumn.js";
import type * as billing from "../billing.js";
import type * as config_aiCosts from "../config/aiCosts.js";
import type * as config_aiModels from "../config/aiModels.js";
import type * as db_collectionTextMarks from "../db/collectionTextMarks.js";
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
import type * as db_stats_recordFreePlayStats from "../db/stats/recordFreePlayStats.js";
import type * as db_stats_recordReviewStats from "../db/stats/recordReviewStats.js";
import type * as db_stats_reverseReviewStats from "../db/stats/reverseReviewStats.js";
import type * as db_stats_reviewDepthAccuracy from "../db/stats/reviewDepthAccuracy.js";
import type * as db_stats_weeklyStats from "../db/stats/weeklyStats.js";
import type * as db_stats_wordTracking from "../db/stats/wordTracking.js";
import type * as db_stats_yearlyStats from "../db/stats/yearlyStats.js";
import type * as db_translationSeed from "../db/translationSeed.js";
import type * as db_userProfiles from "../db/userProfiles.js";
import type * as db_users from "../db/users.js";
import type * as features_accountDeletion from "../features/accountDeletion.js";
import type * as features_authEmailTesting from "../features/authEmailTesting.js";
import type * as features_cardEditAudit from "../features/cardEditAudit.js";
import type * as features_chat_agent from "../features/chat/agent.js";
import type * as features_chat_approvalAudio from "../features/chat/approvalAudio.js";
import type * as features_chat_cardApprovals from "../features/chat/cardApprovals.js";
import type * as features_chat_cardContext from "../features/chat/cardContext.js";
import type * as features_chat_constants from "../features/chat/constants.js";
import type * as features_chat_messages from "../features/chat/messages.js";
import type * as features_chat_promptSections from "../features/chat/promptSections.js";
import type * as features_chat_quickActions from "../features/chat/quickActions.js";
import type * as features_chat_threads from "../features/chat/threads.js";
import type * as features_chat_transcribe from "../features/chat/transcribe.js";
import type * as features_collections from "../features/collections.js";
import type * as features_consent from "../features/consent.js";
import type * as features_courses from "../features/courses.js";
import type * as features_curriculumFlagTesting from "../features/curriculumFlagTesting.js";
import type * as features_customTexts from "../features/customTexts.js";
import type * as features_decks from "../features/decks.js";
import type * as features_featureIds from "../features/featureIds.js";
import type * as features_home from "../features/home.js";
import type * as features_ipa from "../features/ipa.js";
import type * as features_library from "../features/library.js";
import type * as features_llmTranslationQueue from "../features/llmTranslationQueue.js";
import type * as features_onboarding from "../features/onboarding.js";
import type * as features_placementTest from "../features/placementTest.js";
import type * as features_projections from "../features/projections.js";
import type * as features_scheduling from "../features/scheduling.js";
import type * as features_sentenceMetadata from "../features/sentenceMetadata.js";
import type * as features_signupNotification from "../features/signupNotification.js";
import type * as features_stats from "../features/stats.js";
import type * as features_translation from "../features/translation.js";
import type * as features_translationLLM from "../features/translationLLM.js";
import type * as features_tts from "../features/tts.js";
import type * as features_ttsProcessing from "../features/ttsProcessing.js";
import type * as features_tutorialIds from "../features/tutorialIds.js";
import type * as features_welcomeEmail from "../features/welcomeEmail.js";
import type * as http from "../http.js";
import type * as lib_adminEmails from "../lib/adminEmails.js";
import type * as lib_audio from "../lib/audio.js";
import type * as lib_audioAssets from "../lib/audioAssets.js";
import type * as lib_authEmails from "../lib/authEmails.js";
import type * as lib_cardContent from "../lib/cardContent.js";
import type * as lib_collections from "../lib/collections.js";
import type * as lib_dateUtils from "../lib/dateUtils.js";
import type * as lib_dueQueue from "../lib/dueQueue.js";
import type * as lib_emailEnv from "../lib/emailEnv.js";
import type * as lib_freePlay from "../lib/freePlay.js";
import type * as lib_fsrsStates from "../lib/fsrsStates.js";
import type * as lib_localRomanization from "../lib/localRomanization.js";
import type * as lib_posthogAi from "../lib/posthogAi.js";
import type * as lib_rateLimitReserve from "../lib/rateLimitReserve.js";
import type * as lib_resendClient from "../lib/resendClient.js";
import type * as lib_sha256 from "../lib/sha256.js";
import type * as lib_stt_azure from "../lib/stt/azure.js";
import type * as lib_stt_index from "../lib/stt/index.js";
import type * as lib_stt_languageCodes from "../lib/stt/languageCodes.js";
import type * as lib_textAnnotations from "../lib/textAnnotations.js";
import type * as lib_textComparison from "../lib/textComparison.js";
import type * as lib_tts_gemini from "../lib/tts/gemini.js";
import type * as lib_tts_google from "../lib/tts/google.js";
import type * as lib_tts_index from "../lib/tts/index.js";
import type * as lib_tts_languageCodes from "../lib/tts/languageCodes.js";
import type * as lib_tts_minimax from "../lib/tts/minimax.js";
import type * as lib_tts_tailTrim from "../lib/tts/tailTrim.js";
import type * as lib_tts_types from "../lib/tts/types.js";
import type * as lib_ttsSemanticValidation from "../lib/ttsSemanticValidation.js";
import type * as lib_welcomeEmail from "../lib/welcomeEmail.js";
import type * as lib_workpools from "../lib/workpools.js";
import type * as migrations from "../migrations.js";
import type * as migrations_data_essentialGreetingTranslations from "../migrations/data/essentialGreetingTranslations.js";
import type * as migrations_datasetMigration_cutoverUser from "../migrations/datasetMigration_cutoverUser.js";
import type * as migrations_recalcUserCardAggregates from "../migrations/recalcUserCardAggregates.js";
import type * as migrations_seedPlacementTestSentences from "../migrations/seedPlacementTestSentences.js";
import type * as migrations_seedWritingTrack from "../migrations/seedWritingTrack.js";
import type * as migrations_updateEssentialGreetings from "../migrations/updateEssentialGreetings.js";
import type * as posthog from "../posthog.js";
import type * as rateLimiter from "../rateLimiter.js";
import type * as retrier from "../retrier.js";
import type * as tests_lib_audioFixtures from "../tests/lib/audioFixtures.js";
import type * as tests_lib_drainScheduler from "../tests/lib/drainScheduler.js";
import type * as types from "../types.js";
import type * as usage_actions from "../usage/actions.js";
import type * as usage_autumnClient from "../usage/autumnClient.js";
import type * as usage_helpers from "../usage/helpers.js";
import type * as usage_queries from "../usage/queries.js";
import type * as usage_testing from "../usage/testing.js";
import type * as usage_tracking from "../usage/tracking.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "admin/activateDataset": typeof admin_activateDataset;
  "admin/backfillIpa": typeof admin_backfillIpa;
  "admin/cardEdits": typeof admin_cardEdits;
  "admin/dashboard": typeof admin_dashboard;
  "admin/deleteUser": typeof admin_deleteUser;
  "admin/lib": typeof admin_lib;
  "admin/manage": typeof admin_manage;
  "admin/uploadDataset": typeof admin_uploadDataset;
  "admin/userContent": typeof admin_userContent;
  "admin/warmupCourseLevels": typeof admin_warmupCourseLevels;
  "admin/warmupLanguages": typeof admin_warmupLanguages;
  "admin/warmupPlacementTranslations": typeof admin_warmupPlacementTranslations;
  "admin/warmupSingleLanguage": typeof admin_warmupSingleLanguage;
  analytics: typeof analytics;
  auth: typeof auth;
  autumn: typeof autumn;
  billing: typeof billing;
  "config/aiCosts": typeof config_aiCosts;
  "config/aiModels": typeof config_aiModels;
  "db/collectionTextMarks": typeof db_collectionTextMarks;
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
  "db/stats/recordFreePlayStats": typeof db_stats_recordFreePlayStats;
  "db/stats/recordReviewStats": typeof db_stats_recordReviewStats;
  "db/stats/reverseReviewStats": typeof db_stats_reverseReviewStats;
  "db/stats/reviewDepthAccuracy": typeof db_stats_reviewDepthAccuracy;
  "db/stats/weeklyStats": typeof db_stats_weeklyStats;
  "db/stats/wordTracking": typeof db_stats_wordTracking;
  "db/stats/yearlyStats": typeof db_stats_yearlyStats;
  "db/translationSeed": typeof db_translationSeed;
  "db/userProfiles": typeof db_userProfiles;
  "db/users": typeof db_users;
  "features/accountDeletion": typeof features_accountDeletion;
  "features/authEmailTesting": typeof features_authEmailTesting;
  "features/cardEditAudit": typeof features_cardEditAudit;
  "features/chat/agent": typeof features_chat_agent;
  "features/chat/approvalAudio": typeof features_chat_approvalAudio;
  "features/chat/cardApprovals": typeof features_chat_cardApprovals;
  "features/chat/cardContext": typeof features_chat_cardContext;
  "features/chat/constants": typeof features_chat_constants;
  "features/chat/messages": typeof features_chat_messages;
  "features/chat/promptSections": typeof features_chat_promptSections;
  "features/chat/quickActions": typeof features_chat_quickActions;
  "features/chat/threads": typeof features_chat_threads;
  "features/chat/transcribe": typeof features_chat_transcribe;
  "features/collections": typeof features_collections;
  "features/consent": typeof features_consent;
  "features/courses": typeof features_courses;
  "features/curriculumFlagTesting": typeof features_curriculumFlagTesting;
  "features/customTexts": typeof features_customTexts;
  "features/decks": typeof features_decks;
  "features/featureIds": typeof features_featureIds;
  "features/home": typeof features_home;
  "features/ipa": typeof features_ipa;
  "features/library": typeof features_library;
  "features/llmTranslationQueue": typeof features_llmTranslationQueue;
  "features/onboarding": typeof features_onboarding;
  "features/placementTest": typeof features_placementTest;
  "features/projections": typeof features_projections;
  "features/scheduling": typeof features_scheduling;
  "features/sentenceMetadata": typeof features_sentenceMetadata;
  "features/signupNotification": typeof features_signupNotification;
  "features/stats": typeof features_stats;
  "features/translation": typeof features_translation;
  "features/translationLLM": typeof features_translationLLM;
  "features/tts": typeof features_tts;
  "features/ttsProcessing": typeof features_ttsProcessing;
  "features/tutorialIds": typeof features_tutorialIds;
  "features/welcomeEmail": typeof features_welcomeEmail;
  http: typeof http;
  "lib/adminEmails": typeof lib_adminEmails;
  "lib/audio": typeof lib_audio;
  "lib/audioAssets": typeof lib_audioAssets;
  "lib/authEmails": typeof lib_authEmails;
  "lib/cardContent": typeof lib_cardContent;
  "lib/collections": typeof lib_collections;
  "lib/dateUtils": typeof lib_dateUtils;
  "lib/dueQueue": typeof lib_dueQueue;
  "lib/emailEnv": typeof lib_emailEnv;
  "lib/freePlay": typeof lib_freePlay;
  "lib/fsrsStates": typeof lib_fsrsStates;
  "lib/localRomanization": typeof lib_localRomanization;
  "lib/posthogAi": typeof lib_posthogAi;
  "lib/rateLimitReserve": typeof lib_rateLimitReserve;
  "lib/resendClient": typeof lib_resendClient;
  "lib/sha256": typeof lib_sha256;
  "lib/stt/azure": typeof lib_stt_azure;
  "lib/stt/index": typeof lib_stt_index;
  "lib/stt/languageCodes": typeof lib_stt_languageCodes;
  "lib/textAnnotations": typeof lib_textAnnotations;
  "lib/textComparison": typeof lib_textComparison;
  "lib/tts/gemini": typeof lib_tts_gemini;
  "lib/tts/google": typeof lib_tts_google;
  "lib/tts/index": typeof lib_tts_index;
  "lib/tts/languageCodes": typeof lib_tts_languageCodes;
  "lib/tts/minimax": typeof lib_tts_minimax;
  "lib/tts/tailTrim": typeof lib_tts_tailTrim;
  "lib/tts/types": typeof lib_tts_types;
  "lib/ttsSemanticValidation": typeof lib_ttsSemanticValidation;
  "lib/welcomeEmail": typeof lib_welcomeEmail;
  "lib/workpools": typeof lib_workpools;
  migrations: typeof migrations;
  "migrations/data/essentialGreetingTranslations": typeof migrations_data_essentialGreetingTranslations;
  "migrations/datasetMigration_cutoverUser": typeof migrations_datasetMigration_cutoverUser;
  "migrations/recalcUserCardAggregates": typeof migrations_recalcUserCardAggregates;
  "migrations/seedPlacementTestSentences": typeof migrations_seedPlacementTestSentences;
  "migrations/seedWritingTrack": typeof migrations_seedWritingTrack;
  "migrations/updateEssentialGreetings": typeof migrations_updateEssentialGreetings;
  posthog: typeof posthog;
  rateLimiter: typeof rateLimiter;
  retrier: typeof retrier;
  "tests/lib/audioFixtures": typeof tests_lib_audioFixtures;
  "tests/lib/drainScheduler": typeof tests_lib_drainScheduler;
  types: typeof types;
  "usage/actions": typeof usage_actions;
  "usage/autumnClient": typeof usage_autumnClient;
  "usage/helpers": typeof usage_helpers;
  "usage/queries": typeof usage_queries;
  "usage/testing": typeof usage_testing;
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
  cardsByOriginStateAndDueDate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"cardsByOriginStateAndDueDate">;
  cardsByWritingStateAndDueDate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"cardsByWritingStateAndDueDate">;
  cardsByOriginWritingStateAndDueDate: import("@convex-dev/aggregate/_generated/component.js").ComponentApi<"cardsByOriginWritingStateAndDueDate">;
  actionRetrier: import("@convex-dev/action-retrier/_generated/component.js").ComponentApi<"actionRetrier">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
  llmPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"llmPool">;
  llmWarmPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"llmWarmPool">;
  ttsPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"ttsPool">;
  ttsWarmPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"ttsWarmPool">;
  seedPool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"seedPool">;
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
  resend: import("@convex-dev/resend/_generated/component.js").ComponentApi<"resend">;
  posthog: import("@posthog/convex/_generated/component.js").ComponentApi<"posthog">;
};
