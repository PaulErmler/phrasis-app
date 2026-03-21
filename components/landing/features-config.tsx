import {
  Headphones,
  SlidersHorizontal,
  MessageCircle,
  Layers,
  Brain,
  Target,
} from 'lucide-react';

/** Shared feature metadata (no `'use client'`) so RSC can iterate keys/icons safely. */
export const landingFeatureConfig = [
  { key: 'allInOne', icon: Layers, color: 'accent' as const },
  { key: 'selfDriven', icon: SlidersHorizontal, color: 'primary' as const },
  { key: 'instantFeedback', icon: MessageCircle, color: 'accent' as const },
  { key: 'audioBased', icon: Headphones, color: 'primary' as const },
  { key: 'spacedRepetition', icon: Brain, color: 'accent' as const },
  { key: 'languageIntelligence', icon: Target, color: 'primary' as const },
] as const;
