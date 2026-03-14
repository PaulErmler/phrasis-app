import { useTranslations } from 'next-intl';
import {
  DifficultySelector,
  LEVEL_ICONS,
} from '@/components/course/DifficultySelector';
import { CurrentLevel } from '../types';

interface CurrentLevelStepProps {
  selectedLevel: CurrentLevel | null;
  onSelectLevel: (level: CurrentLevel) => void;
}

export function CurrentLevelStep({
  selectedLevel,
  onSelectLevel,
}: CurrentLevelStepProps) {
  const t = useTranslations('Onboarding.difficulty');

  const levels = [
    {
      id: 'beginner' as const,
      icon: LEVEL_ICONS.beginner,
      title: t('beginner.title'),
      description: `${t('beginner.description')} · ${t('beginner.wordCount')}`,
    },
    {
      id: 'elementary' as const,
      icon: LEVEL_ICONS.elementary,
      title: t('elementary.title'),
      description: `${t('elementary.description')} · ${t('elementary.wordCount')}`,
    },
    {
      id: 'intermediate' as const,
      icon: LEVEL_ICONS.intermediate,
      title: t('intermediate.title'),
      description: `${t('intermediate.description')} · ${t('intermediate.wordCount')}`,
    },
    {
      id: 'upper_intermediate' as const,
      icon: LEVEL_ICONS.upper_intermediate,
      title: t('upper_intermediate.title'),
      description: `${t('upper_intermediate.description')} · ${t('upper_intermediate.wordCount')}`,
    },
    {
      id: 'advanced' as const,
      icon: LEVEL_ICONS.advanced,
      title: t('advanced.title'),
      description: `${t('advanced.description')} · ${t('advanced.wordCount')}`,
    },
    {
      id: 'proficient' as const,
      icon: LEVEL_ICONS.proficient,
      title: t('proficient.title'),
      description: `${t('proficient.description')} · ${t('proficient.wordCount')}`,
    },
  ];

  return (
    <DifficultySelector
      title={t('title')}
      selectedLevel={selectedLevel}
      onSelectLevel={onSelectLevel}
      levelOptions={levels}
    />
  );
}
