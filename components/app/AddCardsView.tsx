'use client';

import { useState } from 'react';
import { EnterTextsView } from '@/components/app/EnterTextsView';
import { ImportTextsView } from '@/components/app/import-texts/ImportTextsView';
import {
  ImportModeSwitcher,
  type AddCardsMode,
} from '@/components/app/import-texts/ImportModeSwitcher';

interface AddCardsViewProps {
  onBack: () => void;
}

export function AddCardsView({ onBack }: AddCardsViewProps) {
  const [mode, setMode] = useState<AddCardsMode>('individual');

  const switcher = <ImportModeSwitcher value={mode} onChange={setMode} />;

  return mode === 'individual' ? (
    <EnterTextsView onBack={onBack} headerSlot={switcher} />
  ) : (
    <ImportTextsView onBack={onBack} headerSlot={switcher} />
  );
}
