"use client";

import LoginForm from "./login-form";
import { useTranslations } from "@/app/context/translation-provider";
import { useTheme } from "@/app/hooks/use-theme";
import {
  ChatCircleDotsIcon,
  MoonIcon,
  ShieldCheckIcon,
  SunIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";

export default function LoginScreen({
  ssoError,
}: {
  ssoError?: string | null;
}) {
  const { t } = useTranslations();
  const { theme, toggleTheme } = useTheme();

  const workspaceBenefits = [
    {
      icon: <ChatCircleDotsIcon className="size-5" weight="fill" />,
      label: t("auth.workspaceFeatureContext"),
    },
    {
      icon: <ShieldCheckIcon className="size-5" weight="fill" />,
      label: t("auth.workspaceFeatureTemplates"),
    },
    {
      icon: <WhatsappLogoIcon className="size-5" weight="fill" />,
      label: t("auth.workspaceFeatureUpdates"),
    },
  ];

  return (
    <section className="app-shell flex min-h-[100dvh] w-full items-center justify-center overflow-y-auto p-4 sm:p-6 lg:p-8">
      <button
        onClick={toggleTheme}
        className="icon-action absolute right-5 top-5 z-10 size-11 border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-card))] shadow-sm sm:right-8 sm:top-8"
        title={t(
          theme === "dark" ? "navigation.lightTheme" : "navigation.darkTheme"
        )}
        aria-label={t(
          theme === "dark" ? "navigation.lightTheme" : "navigation.darkTheme"
        )}
      >
        {theme === "dark" ? (
          <SunIcon className="size-5" weight="bold" />
        ) : (
          <MoonIcon className="size-5" weight="bold" />
        )}
      </button>

      <div className="surface-card grid w-full max-w-6xl overflow-hidden rounded-3xl lg:grid-cols-[1.08fr_0.92fr]">
        <aside className="relative hidden min-h-[620px] overflow-hidden bg-[rgb(var(--accent-primary))] p-10 text-white lg:flex lg:flex-col xl:p-14">
          <div className="absolute -right-24 -top-20 size-80 rounded-full border-[36px] border-white/10" />
          <div className="absolute -bottom-28 left-10 size-72 rounded-full border-[28px] border-white/10" />

          <div className="relative flex size-12 items-center justify-center rounded-2xl bg-white/14 ring-1 ring-white/20">
            <WhatsappLogoIcon className="size-7" weight="fill" />
          </div>

          <div className="relative mt-auto max-w-md">
            <p className="text-sm font-semibold tracking-wide text-white/80">
              {t("auth.workspaceEyebrow")}
            </p>
            <h1 className="mt-4 text-4xl font-semibold tracking-[-0.04em] text-balance xl:text-5xl">
              {t("auth.workspaceTitle")}
            </h1>
            <p className="mt-5 max-w-sm text-base leading-7 text-white/80">
              {t("auth.workspaceDescription")}
            </p>

            <ul className="mt-9 space-y-3">
              {workspaceBenefits.map((benefit) => (
                <li
                  className="flex items-center gap-3 text-sm font-medium text-white/90"
                  key={benefit.label}
                >
                  <span className="flex size-8 items-center justify-center rounded-xl bg-white/12 ring-1 ring-white/16">
                    {benefit.icon}
                  </span>
                  {benefit.label}
                </li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="flex flex-col justify-center p-6 sm:p-10 lg:min-h-[620px] lg:p-12 xl:p-14">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]">
              <WhatsappLogoIcon className="size-6" weight="fill" />
            </span>
            <span className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {t("auth.workspaceEyebrow")}
            </span>
          </div>

          <header className="mb-8">
            <h2 className="text-3xl font-semibold tracking-[-0.035em] text-[rgb(var(--text-primary))]">
              {t("auth.title")}
            </h2>
            <p className="mt-3 max-w-md text-sm leading-6 text-[rgb(var(--text-secondary))]">
              {t("auth.subtitle")}
            </p>
          </header>

          {ssoError && (
            <div
              className="mb-5 rounded-xl border border-[rgb(var(--status-error)/0.32)] bg-[rgb(var(--status-error)/0.1)] px-4 py-3 text-sm text-[rgb(var(--status-error))]"
              role="alert"
            >
              <strong>{t("auth.ssoError")}:</strong> {ssoError}
            </div>
          )}

          <LoginForm />
        </div>
      </div>
    </section>
  );
}
