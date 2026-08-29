import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GraduationCap } from 'lucide-react';
import { DifficultySelector } from '@/components/course/DifficultySelector';

const levels = [
  {
    id: 'beginner' as const,
    icon: GraduationCap,
    title: 'Beginner',
    description: 'Just starting',
  },
  {
    id: 'intermediate' as const,
    icon: GraduationCap,
    title: 'Intermediate',
    description: 'Middle',
  },
];

describe('DifficultySelector', () => {
  it('renders all provided levels', () => {
    render(
      <DifficultySelector
        selectedLevel={null}
        onSelectLevel={() => {}}
        levelOptions={levels as any}
      />,
    );
    expect(screen.getByText('Beginner')).toBeInTheDocument();
    expect(screen.getByText('Intermediate')).toBeInTheDocument();
  });

  it('renders title and subtitle', () => {
    render(
      <DifficultySelector
        title="Pick level"
        subtitle="sub"
        selectedLevel={null}
        onSelectLevel={() => {}}
        levelOptions={levels as any}
      />,
    );
    expect(screen.getByText('Pick level')).toBeInTheDocument();
    expect(screen.getByText('sub')).toBeInTheDocument();
  });

  it('calls onSelectLevel', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <DifficultySelector
        selectedLevel={null}
        onSelectLevel={onSelect}
        levelOptions={levels as any}
      />,
    );
    await user.click(screen.getByText('Beginner'));
    expect(onSelect).toHaveBeenCalledWith('beginner');
  });
});
