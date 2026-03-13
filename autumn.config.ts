import { feature, item, plan } from 'atmn';

import { FEATURE_IDS } from './convex/features/featureIds';

// Features
export const reviews = feature({
	id: 'reviews',
	name: 'Reviews',
	type: 'metered',
	consumable: true,
});

export const multiple_languages = feature({
	id: 'multiple_languages',
	name: 'Up To 5 Languages per Course',
	type: 'boolean',
});

export const custom_phrases = feature({
	id: 'custom_phrases',
	name: 'Custom Phrases',
	type: 'metered',
	consumable: true,
	archived: true,
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

// Plans
export const free = plan({
	id: 'free',
	name: 'Free',
	autoEnable: true,
	items: [
		item({
			featureId: chat_messages.id,
			included: 5,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: courses.id,
			included: 1,
		}),
		item({
			featureId: custom_sentences.id,
			included: 10,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: sentences.id,
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
			featureId: chat_messages.id,
			included: 40,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: courses.id,
			included: 2,
		}),
		item({
			featureId: custom_sentences.id,
			included: 50,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: sentences.id,
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
		amount: 18,
		interval: 'month',
	},
	items: [
		item({
			featureId: chat_messages.id,
			included: 100,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: courses.id,
			included: 5,
		}),
		item({
			featureId: custom_sentences.id,
			included: 200,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: sentences.id,
			included: 1000,
			reset: {
				interval: 'month',
			},
		}),
		item({
			featureId: multiple_languages.id,
			included: 0,
		}),
	],
});
