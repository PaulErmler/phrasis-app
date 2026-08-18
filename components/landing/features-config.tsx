import {
  Headphones,
  Sparkles,
  MessageCircle,
  Layers,
  Brain,
  Sprout,
  type LucideIcon,
} from 'lucide-react';

export const landingFeatureConfig: {
  key:
    | 'audioBased'
    | 'selfDriven'
    | 'instantFeedback'
    | 'allInOne'
    | 'spacedRepetition'
    | 'languageIntelligence';
  icon: LucideIcon;
}[] = [
  { key: 'audioBased', icon: Headphones },
  { key: 'selfDriven', icon: Sparkles },
  { key: 'instantFeedback', icon: MessageCircle },
  { key: 'allInOne', icon: Layers },
  { key: 'spacedRepetition', icon: Brain },
  { key: 'languageIntelligence', icon: Sprout },
];
