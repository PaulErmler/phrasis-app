import { feature, item, plan } from 'atmn';

import { CREDIT_COSTS } from './convex/features/featureIds';

// Features
export const multiple_languages = feature({
  id: 'multiple_languages',
  name: 'Up To 3 Languages per Course',
  type: 'boolean',
});

export const chat_messages = feature({
  id: 'chat_messages',
  name: 'Chat Messages',
  type: 'metered',
  consumable: true,
});

export const courses = feature({
  id: 'courses',
  name: 'Courses',
  type: 'metered',
  consumable: false,
});

export const sentences = feature({
  id: 'sentences',
  name: 'Sentences',
  type: 'metered',
  consumable: true,
});

export const custom_sentences = feature({
  id: 'custom_sentences',
  name: 'Custom Sentences',
  type: 'metered',
  consumable: true,
});

export const transcriptions = feature({
  id: 'transcriptions',
  name: 'Transcriptions',
  type: 'metered',
  consumable: true,
});

export const card_edits = feature({
  id: 'card_edits',
  name: 'Card Edits',
  type: 'metered',
  consumable: true,
});

export const translation_auto_fill = feature({
  id: 'translation_auto_fill',
  name: 'Translation Auto Fill',
  type: 'metered',
  consumable: true,
});

// Internal-only meters: hidden from the pricing table (gated client-side

// via `isFeatureHidden` in `lib/features/feature-meta.ts`) but enforced by

// `consumeQuota` in the corresponding card-action mutations.
export const audio_regenerations = feature({
  id: 'audio_regenerations',
  name: 'Audio Regenerations',
  type: 'metered',
  consumable: true,
});

export const translation_flags = feature({
  id: 'translation_flags',
  name: 'Translation Flags',
  type: 'metered',
  consumable: true,
});

// Credit system: chat messages, custom sentence creation, and translation
// auto-fill draw from a shared credit pool instead of separate meters.
// Always check/track the underlying feature ids — Autumn converts usage
// into credit deductions via this schema. The schema is derived from
// CREDIT_COSTS in convex/features/featureIds.ts, so that single table also
// drives quota checks and local balance math. Chat cost is dynamic: the
// app tracks 1 chat_messages unit up-front plus 1 more per additional
// started $0.005 of LLM cost (see convex/features/chat/messages.ts).
export const credits = feature({
  id: 'credits',
  name: 'Credits',
  type: 'credit_system',
  creditSchema: Object.entries(CREDIT_COSTS).map(
    ([meteredFeatureId, creditCost]) => ({ meteredFeatureId, creditCost }),
  ),
});

// Plans
export const free = plan({
  id: 'free',
  name: 'Free',
  autoEnable: true,
  items: [
    item({
      featureId: audio_regenerations.id,
      included: 20,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: card_edits.id,
      included: 50,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: courses.id,
      included: 1,
    }),
    item({
      featureId: credits.id,
      included: 200,
      reset: {
        interval: 'one_off',
      },
    }),
    item({
      featureId: credits.id,
      included: 30,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: sentences.id,
      included: 300,
      reset: {
        interval: 'one_off',
      },
    }),
    item({
      featureId: sentences.id,
      included: 50,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: transcriptions.id,
      included: 10,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: translation_flags.id,
      included: 20,
      reset: {
        interval: 'month',
      },
    }),
  ],
});

export const basic = plan({
  id: 'basic',
  name: 'Basic',
  price: {
    amount: 8,
    interval: 'month',
  },
  items: [
    item({
      featureId: audio_regenerations.id,
      included: 500,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: card_edits.id,
      included: 500,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: courses.id,
      included: 1,
    }),
    // 430 = Free's 30/month + 400, so the pricing table's cumulative
    // "Everything from Free, plus:" line reads as a round 400.
    item({
      featureId: credits.id,
      included: 430,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: sentences.id,
      included: 20000,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: transcriptions.id,
      included: 100,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: translation_flags.id,
      included: 500,
      reset: {
        interval: 'month',
      },
    }),
  ],
  freeTrial: { durationLength: 7, durationType: 'day', cardRequired: true },
});

// Annual variants: same entitlements as the base plan (items inherited,
// monthly resets included), priced 25% below 12x monthly. The 7-day
// card-required trial is inherited from the base plans.
export const basic_annual = basic.variant({
  id: 'basic_annual',
  name: 'Basic Annual',
  customize: {
    price: { amount: 72, interval: 'year' },
  },
});

export const pro = plan({
  id: 'pro',
  name: 'Pro',
  price: {
    amount: 16,
    interval: 'month',
  },
  items: [
    item({
      featureId: audio_regenerations.id,
      included: 800,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: card_edits.id,
      included: 800,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: courses.id,
      included: 10,
    }),
    // 1030 = Basic's 430 + 600 — see the note on Basic: the pricing table
    // lists each tier as what it adds over the one below, so the grants
    // are tuned to make those increments round.
    item({
      featureId: credits.id,
      included: 1030,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: sentences.id,
      included: 20000,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: transcriptions.id,
      included: 400,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: translation_flags.id,
      included: 800,
      reset: {
        interval: 'month',
      },
    }),
    item({ featureId: multiple_languages.id }),
  ],
  freeTrial: { durationLength: 7, durationType: 'day', cardRequired: true },
});

export const pro_annual = pro.variant({
  id: 'pro_annual',
  name: 'Pro Annual',
  customize: {
    price: { amount: 144, interval: 'year' },
  },
});

// Ultra is Pro with a bigger credit pool — every other entitlement is
// deliberately identical, so the only reason to upgrade is credit-hungry
// AI usage (chat, custom sentences, translation auto-fill).
export const ultra = plan({
  id: 'ultra',
  name: 'Ultra',
  price: {
    amount: 32,
    interval: 'month',
  },
  items: [
    item({
      featureId: audio_regenerations.id,
      included: 800,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: card_edits.id,
      included: 800,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: courses.id,
      included: 10,
    }),
    // 3030 = Pro's 1030 + 2000.
    item({
      featureId: credits.id,
      included: 3030,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: sentences.id,
      included: 20000,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: transcriptions.id,
      included: 400,
      reset: {
        interval: 'month',
      },
    }),
    item({
      featureId: translation_flags.id,
      included: 800,
      reset: {
        interval: 'month',
      },
    }),
    item({ featureId: multiple_languages.id }),
  ],
  freeTrial: { durationLength: 7, durationType: 'day', cardRequired: true },
});

export const ultra_annual = ultra.variant({
  id: 'ultra_annual',
  name: 'Ultra Annual',
  customize: {
    price: { amount: 288, interval: 'year' },
  },
});
