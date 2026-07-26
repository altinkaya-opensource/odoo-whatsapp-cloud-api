"use client";

import { useTranslations } from "@/app/context/translation-provider";
import { ComputerTower } from "@phosphor-icons/react";

export default function SessionBlockedOverlay() {
  const { t } = useTranslations();

  return (
    <div className="app-shell fixed inset-0 z-[9999] flex items-center justify-center p-4">
      <div className="surface-card flex w-full max-w-md flex-col items-center gap-6 rounded-2xl px-8 py-10 text-center">
        {/* Icon */}
        <div className="flex size-20 items-center justify-center rounded-2xl bg-[rgb(var(--accent-primary)/0.12)]">
          <ComputerTower
            size={48}
            weight="fill"
            className="text-[rgb(var(--accent-primary))]"
          />
        </div>

        {/* Title */}
        <h1 className="text-2xl font-semibold tracking-[-0.025em] text-[rgb(var(--text-primary))]">
          {t("sessionSync.blocked.title")}
        </h1>

        {/* Message */}
        <p className="text-base leading-relaxed text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))]">
          {t("sessionSync.blocked.message")}
        </p>

        {/* Footer hint */}
        <p className="text-sm text-[rgb(var(--text-secondary)/var(--text-tertiary-opacity))]">
          {t("sessionSync.blocked.footer")}
        </p>
      </div>
    </div>
  );
}
