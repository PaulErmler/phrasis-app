"use client";

import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

/**
 * Button that triggers the global PWA install dialog.
 * The actual pwa-install element is rendered in PWAInstallGlobal component at the root level.
 */
export function PWAInstallButton() {
  const handleInstallClick = () => {
    const pwaInstallElement = document.querySelector("pwa-install") as HTMLElement & {
      showDialog: () => void;
    } | null;

    if (pwaInstallElement) {
      pwaInstallElement.showDialog();
    }
  };

  return (
    <Button
      onClick={handleInstallClick}
      variant="outline"
      size="sm"
      className="gap-2"
    >
      <Download className="w-4 h-4" />
      Install Phrasis
    </Button>
  );
}

