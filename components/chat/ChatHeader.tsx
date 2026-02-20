import { SignedIn, UserButton } from '@daveyplate/better-auth-ui';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

interface ChatHeaderProps {
  onBack?: () => void;
}

/**
 * Chat page header component with logo, back button, and user controls
 */
export function ChatHeader({ onBack }: ChatHeaderProps) {
  return (
    <header className="shrink-0 z-10 bg-background/80 backdrop-blur-md border-b border-border">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="mr-2"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <span className="text-sm font-bold text-white">P</span>
          </div>
          <span className="heading-section">Cacatua</span>
        </div>
        <div className="flex items-center gap-4">
          <SignedIn>
            <UserButton size="icon" />
          </SignedIn>
        </div>
      </div>
    </header>
  );
}
