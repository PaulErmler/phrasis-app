"use client";

import { GraduationCap, BookOpen, MessageSquare, Globe, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type DifficultyLevel = "beginner" | "elementary" | "intermediate" | "upper_intermediate" | "advanced";

interface LevelOption {
  id: DifficultyLevel;
  icon: typeof GraduationCap;
  title: string;
  description: string;
}

interface DifficultySelectorProps {
  title?: string;
  subtitle?: string;
  selectedLevel: DifficultyLevel | null;
  onSelectLevel: (level: DifficultyLevel) => void;
  levelOptions: LevelOption[];
}

export function DifficultySelector({
  title,
  subtitle,
  selectedLevel,
  onSelectLevel,
  levelOptions,
}: DifficultySelectorProps) {
  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {title && (
        <div className="text-center space-y-2 py-4">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && (
            <p className="text-muted-sm">{subtitle}</p>
          )}
        </div>
      )}
      
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto py-4 pr-3">
        {levelOptions.map((level) => {
          const Icon = level.icon;
          const isSelected = selectedLevel === level.id;
          
          return (
            <Button
              key={level.id}
              variant="ghost"
              onClick={() => onSelectLevel(level.id)}
              className={cn(
                "w-full h-auto flex items-center justify-start gap-4 p-4 rounded-xl border-2 transition-all text-left whitespace-normal",
                isSelected
                  ? "border-primary bg-primary/5 shadow-sm hover:bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30 hover:bg-muted/50"
              )}
            >
              <div className="p-2.5 rounded-lg shrink-0 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base leading-none mb-1">
                  {level.title}
                </h3>
                <p className="text-muted-sm">
                  {level.description}
                </p>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

// Export the level icons for use in other components
export const LEVEL_ICONS = {
  beginner: GraduationCap,
  elementary: BookOpen,
  intermediate: MessageSquare,
  upper_intermediate: Globe,
  advanced: Star,
};

