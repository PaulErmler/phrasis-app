"use client";

import { useTranslations } from "next-intl";
import { Flame, RotateCcw, MessageSquare, Clock } from "lucide-react";

function StatItem({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="text-center">
      <Icon className="mx-auto h-5 w-5 text-muted-foreground mb-1" />
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

export function ProgressStatsCard() {
  const t = useTranslations("AppPage");

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="grid grid-cols-4 gap-3">
        <StatItem icon={Flame} label={t("stats.streak")} value="0" />
        <StatItem icon={RotateCcw} label={t("stats.reps")} value="127" />
        <StatItem icon={MessageSquare} label={t("stats.sentences")} value="42" />
        <StatItem icon={Clock} label={t("stats.time")} value="23m" />
      </div>
    </div>
  );
}
