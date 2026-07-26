"use client";

import { WifiXIcon, SignOutIcon } from "@phosphor-icons/react";
import { useTranslations } from "../context/translation-provider";
import { useAuth } from "../hooks/use-auth";
import { useConnection } from "../context/connection-provider";

export default function ConnectionOverlay() {
  const { connectionStatus } = useConnection();
  const { t } = useTranslations();
  const { logout } = useAuth();

  const isVisible = connectionStatus !== "connected";

  const handleRetry = () => {
    window.location.reload();
  };

  const handleLogout = () => {
    logout();
  };

  if (!isVisible) {
    return null;
  }

  const getOverlayContent = () => {
    switch (connectionStatus) {
      case "disconnected":
        return {
          icon: (
            <WifiXIcon
              className="size-16 text-[rgb(var(--status-error))]"
              weight="bold"
            />
          ),
          title: t("connection.disconnected.title") || "Connection Lost",
          message:
            t("connection.disconnected.message") ||
            "Unable to connect to the server. Please check your internet connection.",
          buttonText: t("connection.retry") || "Retry",
          buttonAction: handleRetry,
          buttonClass: "primary-action",
        };
      case "session-expired":
        return {
          icon: (
            <SignOutIcon
              className="size-16 text-[rgb(var(--status-warning))]"
              weight="bold"
            />
          ),
          title: t("connection.sessionExpired.title") || "Session Expired",
          message:
            t("connection.sessionExpired.message") ||
            "Your session has expired. Please log in again.",
          buttonText: t("connection.login") || "Log In",
          buttonAction: handleLogout,
          buttonClass: "primary-action",
        };
      default:
        return null;
    }
  };

  const content = getOverlayContent();
  if (!content) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgb(var(--bg-overlay)/var(--bg-overlay-opacity))] p-4 backdrop-blur-sm">
      <div
        className="surface-card w-full max-w-md rounded-2xl p-8 text-center"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="connection-overlay-title"
      >
        <div className="flex flex-col items-center gap-6">
          <div className="flex size-20 items-center justify-center rounded-2xl bg-[rgb(var(--bg-secondary))]">
            {content.icon}
          </div>

          <div className="space-y-3">
            <h2
              id="connection-overlay-title"
              className="text-2xl font-semibold tracking-[-0.025em] text-[rgb(var(--text-primary))]"
            >
              {content.title}
            </h2>
            <p className="text-[rgb(var(--text-secondary))] leading-relaxed">
              {content.message}
            </p>
          </div>

          <button
            onClick={content.buttonAction}
            className={`w-full px-6 py-3 font-semibold ${content.buttonClass}`}
          >
            {content.buttonText}
          </button>

          {connectionStatus === "disconnected" && (
            <div className="flex items-center justify-center gap-2 text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))] text-sm">
              <WifiXIcon className="size-4" />
              <span>
                {t("connection.checking") || "Checking connection..."}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
