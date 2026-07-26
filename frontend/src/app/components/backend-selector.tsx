"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/app/hooks/use-auth";
import { useChats } from "@/app/hooks/use-chats";
import { useTranslations } from "@/app/context/translation-provider";
import { CaretDown, Check } from "@phosphor-icons/react";

export default function BackendSelector() {
  const { backendIds, backendNames } = useAuth();
  const { selectedBackendId, setSelectedBackendId } = useChats();
  const { t } = useTranslations();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          setIsOpen(false);
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [isOpen]);

  const handleSelect = (backendId: number | null) => {
    setSelectedBackendId(backendId);
    setIsOpen(false);
  };

  const getDisplayName = () => {
    if (selectedBackendId === null) {
      return t("chat.backendSelector.allBackends");
    }
    return backendNames[selectedBackendId] ?? `Backend ${selectedBackendId}`;
  };

  // Only show selector if user has more than 1 backend
  if (backendIds.length <= 1) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-2 px-5" ref={dropdownRef}>
      <label className="text-xs font-semibold text-[rgb(var(--text-secondary))]">
        {t("chat.backendSelector.selectBackend")}
      </label>

      <div className="relative">
        {/* Dropdown Button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="control-field flex w-full items-center justify-between px-3.5 py-3 text-sm font-semibold"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <span>{getDisplayName()}</span>
          <CaretDown
            className={`size-4 text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))] transition-transform ${
              isOpen ? "rotate-180" : ""
            }`}
            weight="bold"
          />
        </button>

        {/* Dropdown Menu */}
        {isOpen && (
          <div
            className="surface-card custom-scrollbar absolute z-50 mt-2 max-h-60 w-full overflow-y-auto rounded-xl p-1"
            role="listbox"
            aria-label={t("chat.backendSelector.selectBackend")}
          >
            {/* All Backends Option */}
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-[rgb(var(--text-primary))] transition-colors hover:bg-[rgb(var(--accent-hover)/var(--accent-hover-opacity))]"
              role="option"
              aria-selected={selectedBackendId === null}
            >
              <span>{t("chat.backendSelector.allBackends")}</span>
              {selectedBackendId === null && (
                <Check
                  className="size-4 text-[rgb(var(--accent-primary))]"
                  weight="bold"
                />
              )}
            </button>

            {/* Individual Backend Options */}
            {backendIds.map((backendId) => {
              const displayName =
                backendNames[backendId] ?? `Backend ${backendId}`;
              const isSelected = selectedBackendId === backendId;

              return (
                <button
                  key={backendId}
                  type="button"
                  onClick={() => handleSelect(backendId)}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm text-[rgb(var(--text-primary))] transition-colors hover:bg-[rgb(var(--accent-hover)/var(--accent-hover-opacity))]"
                  role="option"
                  aria-selected={isSelected}
                >
                  <span>{displayName}</span>
                  {isSelected && (
                    <Check
                      className="size-4 text-[rgb(var(--accent-primary))]"
                      weight="bold"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
