"use client";

import {
  BellRingingIcon,
  CheckIcon,
  MoonIcon,
  PaletteIcon,
  SlidersHorizontalIcon,
  SunIcon,
  TextTIcon,
  TranslateIcon,
} from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "@/app/context/translation-provider";
import {
  type ColorScheme,
  type TextSize,
  type WorkspaceBackground,
} from "@/app/context/theme-provider";
import { useProfile } from "@/app/hooks/use-profile";
import { useTheme } from "@/app/hooks/use-theme";
import {
  getNotificationPermission,
  requestNotificationPermission,
} from "@/app/lib/notifications";
import LanguageSelector from "./language-selector";
import Profile from "./profile";

type SettingChoiceProps = {
  selected: boolean;
  onClick: () => void;
  label: string;
  description: string;
  preview: ReactNode;
};

function SettingChoice({
  selected,
  onClick,
  label,
  description,
  preview,
}: SettingChoiceProps) {
  return (
    <button
      className={`group relative flex min-h-20 min-w-0 items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-primary))] focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--bg-card))] ${
        selected
          ? "border-[rgb(var(--accent-primary)/0.62)] bg-[rgb(var(--accent-primary)/0.1)]"
          : "border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-secondary)/0.5)] hover:border-[rgb(var(--border-secondary)/var(--border-secondary-opacity))] hover:bg-[rgb(var(--bg-secondary))]"
      }`}
      onClick={onClick}
      aria-pressed={selected}
      type="button"
    >
      {preview}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[rgb(var(--text-primary))]">
          {label}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-[rgb(var(--text-secondary))]">
          {description}
        </span>
      </span>
      {selected && (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--accent-primary))] text-white">
          <CheckIcon className="size-3.5" weight="bold" aria-hidden="true" />
        </span>
      )}
    </button>
  );
}

type SettingsSectionProps = {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
};

function SettingsSection({
  icon,
  title,
  description,
  children,
}: SettingsSectionProps) {
  return (
    <section className="surface-card rounded-2xl p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[rgb(var(--text-primary))]">
            {title}
          </h2>
          <p className="mt-1 text-sm leading-5 text-[rgb(var(--text-secondary))]">
            {description}
          </p>
        </div>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * Desktop notification opt-in.
 *
 * The browser only shows the permission prompt for a request that comes from
 * a real click, so it lives behind this button instead of firing on load.
 */
function NotificationSetting() {
  const { t } = useTranslations();
  const [permission, setPermission] = useState<NotificationPermission | null>(
    null
  );

  useEffect(() => {
    setPermission(getNotificationPermission());
  }, []);

  if (permission === null) {
    return (
      <p className="text-sm text-[rgb(var(--text-secondary))]">
        {t("settings.notificationsUnsupported")}
      </p>
    );
  }

  const status =
    permission === "granted"
      ? t("settings.notificationsEnabled")
      : permission === "denied"
        ? t("settings.notificationsBlocked")
        : t("settings.notificationsPrompt");

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="min-w-0 flex-1 text-sm text-[rgb(var(--text-secondary))]">
        {status}
      </p>
      {permission === "default" && (
        <button
          type="button"
          onClick={async () => {
            setPermission(await requestNotificationPermission());
          }}
          className="rounded-lg bg-[rgb(var(--accent-primary))] px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--accent-primary))]"
        >
          {t("settings.notificationsEnable")}
        </button>
      )}
    </div>
  );
}

export default function SettingsPanel() {
  const { t } = useTranslations();
  const {
    theme,
    setTheme,
    colorScheme,
    setColorScheme,
    background,
    setBackground,
    textSize,
    setTextSize,
  } = useTheme();
  const {
    profile: { avatarUrl, id, name },
  } = useProfile();

  const colorOptions: Array<{
    value: ColorScheme;
    label: string;
    description: string;
    previewClassName: string;
  }> = [
    {
      value: "plum",
      label: t("settings.colorPlum"),
      description: t("settings.colorPlumDescription"),
      previewClassName: "bg-[#7d5b76]",
    },
    {
      value: "cobalt",
      label: t("settings.colorCobalt"),
      description: t("settings.colorCobaltDescription"),
      previewClassName: "bg-[#5890e7]",
    },
    {
      value: "verdant",
      label: t("settings.colorVerdant"),
      description: t("settings.colorVerdantDescription"),
      previewClassName: "bg-[#36b17f]",
    },
  ];

  const backgroundOptions: Array<{
    value: WorkspaceBackground;
    label: string;
    description: string;
    previewClassName: string;
  }> = [
    {
      value: "soft",
      label: t("settings.backgroundSoft"),
      description: t("settings.backgroundSoftDescription"),
      previewClassName:
        "bg-[radial-gradient(circle_at_top_left,rgb(var(--accent-primary)/0.7),transparent_58%),rgb(var(--bg-tertiary))]",
    },
    {
      value: "grid",
      label: t("settings.backgroundGrid"),
      description: t("settings.backgroundGridDescription"),
      previewClassName:
        "bg-[linear-gradient(rgb(var(--border-primary)/0.55)_1px,transparent_1px),linear-gradient(90deg,rgb(var(--border-primary)/0.55)_1px,transparent_1px),rgb(var(--bg-tertiary))] bg-[size:8px_8px]",
    },
    {
      value: "plain",
      label: t("settings.backgroundPlain"),
      description: t("settings.backgroundPlainDescription"),
      previewClassName: "bg-[rgb(var(--bg-tertiary))]",
    },
  ];

  const textSizeOptions: Array<{
    value: TextSize;
    label: string;
    description: string;
    previewClassName: string;
  }> = [
    {
      value: "compact",
      label: t("settings.textCompact"),
      description: t("settings.textCompactDescription"),
      previewClassName: "text-sm",
    },
    {
      value: "comfortable",
      label: t("settings.textComfortable"),
      description: t("settings.textComfortableDescription"),
      previewClassName: "text-base",
    },
    {
      value: "large",
      label: t("settings.textLarge"),
      description: t("settings.textLargeDescription"),
      previewClassName: "text-lg",
    },
  ];

  return (
    <section className="custom-scrollbar flex h-full min-h-0 w-full flex-col gap-4 overflow-y-auto p-4 sm:p-5">
      <header className="flex items-center gap-3 px-1">
        <Profile
          size="12"
          url={avatarUrl}
          alt={name}
          seed={id ? Number(id) : undefined}
        />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-[-0.025em] text-[rgb(var(--text-primary))]">
            {t("settings.title")}
          </h1>
          <p className="mt-0.5 truncate text-sm text-[rgb(var(--text-secondary))]">
            {t("settings.description")}
          </p>
        </div>
      </header>

      <SettingsSection
        icon={<TranslateIcon className="size-5" weight="bold" />}
        title={t("settings.language")}
        description={t("settings.languageDescription")}
      >
        <LanguageSelector />
      </SettingsSection>

      <SettingsSection
        icon={<BellRingingIcon className="size-5" weight="bold" />}
        title={t("settings.notifications")}
        description={t("settings.notificationsDescription")}
      >
        <NotificationSetting />
      </SettingsSection>

      <SettingsSection
        icon={<SlidersHorizontalIcon className="size-5" weight="bold" />}
        title={t("settings.appearance")}
        description={t("settings.appearanceDescription")}
      >
        <div className="space-y-5">
          <fieldset>
            <legend className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {t("settings.theme")}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <SettingChoice
                selected={theme === "dark"}
                onClick={() => setTheme("dark")}
                label={t("settings.dark")}
                description={t("settings.darkDescription")}
                preview={
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(21_20_26)] text-[#d8cdd8]">
                    <MoonIcon className="size-5" weight="fill" />
                  </span>
                }
              />
              <SettingChoice
                selected={theme === "light"}
                onClick={() => setTheme("light")}
                label={t("settings.light")}
                description={t("settings.lightDescription")}
                preview={
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#f8f7f9] text-[#654461] ring-1 ring-[#d9d4dc]">
                    <SunIcon className="size-5" weight="fill" />
                  </span>
                }
              />
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {t("settings.colorScheme")}
            </legend>
            <div className="mt-2 grid gap-2">
              {colorOptions.map((option) => (
                <SettingChoice
                  key={option.value}
                  selected={colorScheme === option.value}
                  onClick={() => setColorScheme(option.value)}
                  label={option.label}
                  description={option.description}
                  preview={
                    <span
                      className={`relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-xl ${option.previewClassName}`}
                    >
                      <span className="absolute inset-0 bg-[linear-gradient(135deg,rgb(255_255_255/0.32),transparent_54%)]" />
                    </span>
                  }
                />
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {t("settings.background")}
            </legend>
            <div className="mt-2 grid gap-2">
              {backgroundOptions.map((option) => (
                <SettingChoice
                  key={option.value}
                  selected={background === option.value}
                  onClick={() => setBackground(option.value)}
                  label={option.label}
                  description={option.description}
                  preview={
                    <span
                      className={`size-9 shrink-0 rounded-xl border border-[rgb(var(--border-primary)/0.48)] ${option.previewClassName}`}
                    />
                  }
                />
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-sm font-semibold text-[rgb(var(--text-primary))]">
              {t("settings.textSize")}
            </legend>
            <div className="mt-2 grid gap-2">
              {textSizeOptions.map((option) => (
                <SettingChoice
                  key={option.value}
                  selected={textSize === option.value}
                  onClick={() => setTextSize(option.value)}
                  label={option.label}
                  description={option.description}
                  preview={
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--bg-tertiary))] text-[rgb(var(--text-primary))]">
                      <TextTIcon
                        className={option.previewClassName}
                        weight="bold"
                      />
                    </span>
                  }
                />
              ))}
            </div>
          </fieldset>
        </div>
      </SettingsSection>

      <section className="flex items-center gap-3 rounded-2xl border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-secondary)/0.42)] p-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]">
          <PaletteIcon className="size-5" weight="fill" />
        </span>
        <p className="text-sm leading-5 text-[rgb(var(--text-secondary))]">
          {t("settings.savedLocally")}
        </p>
      </section>
    </section>
  );
}
