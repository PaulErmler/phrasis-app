import { feature, item, plan } from 'atmn';

import { FEATURE_IDS } from './convex/features/featureIds';

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
// into credit deductions via this schema. Keep the costs in sync with
// CREDIT_COSTS in convex/features/featureIds.ts. Chat cost is dynamic: the
// app tracks 1 chat_messages unit up-front plus 1 more per additional
// started $0.005 of LLM cost (see convex/features/chat/messages.ts).
export const credits = feature({
	id: 'credits',
	name: 'Credits',
	type: 'credit_system',
	creditSchema: [{ meteredFeatureId: 'custom_sentences', creditCost: 1 }, { meteredFeatureId: 'translation_auto_fill', creditCost: 1 }, { meteredFeatureId: 'chat_messages', creditCost: 1 }],
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
		item({
			featureId: credits.id,
			included: 400,
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
		item({
			featureId: credits.id,
			included: 1200,
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
