import { cn } from '@/lib/utils';

export function FloatingSpeechBubble({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <div
      className={cn(
        'absolute px-4 py-2 rounded-2xl bg-card/80 backdrop-blur-sm border border-border/50 shadow-lg',
        'animate-float text-sm font-medium',
        className,
      )}
      style={{ animationDelay: `${delay}s` }}
    >
      {children}
      <div className="absolute -bottom-2 left-6 w-4 h-4 bg-card/80 border-b border-r border-border/50 rotate-45" />
    </div>
  );
}
