import { feature, item, plan } from 'atmn';
import { FEATURE_IDS } from './convex/features/featureIds';

// Features
export const chat_messages = feature({
	id: FEATURE_IDS.CHAT_MESSAGES,
	name: 'Chat Messages',
	type: 'metered',
	consumable: true,
});

export const courses = feature({
	id: FEATURE_IDS.COURSES,
	name: 'Courses',
	type: 'metered',
	consumable: false,
});

export const reviews = feature({
	id: 'reviews',
	name: 'Reviews',
	type: 'metered',
	consumable: true,
});

export const sentences = feature({
	id: FEATURE_IDS.SENTENCES,
	name: 'Sentences',
	type: 'metered',
	consumable: true,
});

export const custom_sentences = feature({
	id: FEATURE_IDS.CUSTOM_SENTENCES,
	name: 'Custom Sentences',
	type: 'metered',
	consumable: true,
});

export const multiple_languages = feature({
	id: 'multiple_languages',
	name: 'Up To 4 Languages per Course',
	type: 'boolean',
});

export const custom_phrases = feature({
	id: 'custom_phrases',
	name: 'Custom Phrases',
	type: 'metered',
	consumable: true,
	archived: true,
});

// Plans
export const free = plan({
	id: 'free',
	name: 'Free',
	autoEnable: true,
	items: [
		item({
			featureId: FEATURE_IDS.CHAT_MESSAGES,
			included: 5,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: FEATURE_IDS.COURSES,
			included: 1,
		}),
		item({
			featureId: FEATURE_IDS.CUSTOM_SENTENCES,
			included: 10,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: FEATURE_IDS.SENTENCES,
			included: 150,
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
			featureId: FEATURE_IDS.CHAT_MESSAGES,
			included: 40,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: FEATURE_IDS.COURSES,
			included: 2,
		}),
		item({
			featureId: FEATURE_IDS.CUSTOM_SENTENCES,
			included: 50,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: FEATURE_IDS.SENTENCES,
			included: 300,
			reset: {
				interval: 'month',
			},
		}),
	],
});

export const pro = plan({
	id: 'pro',
	name: 'Pro',
	price: {
		amount: 19,
		interval: 'month',
	},
	items: [
		item({
			featureId: FEATURE_IDS.CHAT_MESSAGES,
			included: 100,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: FEATURE_IDS.COURSES,
			included: 5,
		}),
		item({
			featureId: FEATURE_IDS.CUSTOM_SENTENCES,
			included: 200,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: FEATURE_IDS.SENTENCES,
			included: 1000,
			reset: {
				interval: 'month',
			},
		}),
	],
});
