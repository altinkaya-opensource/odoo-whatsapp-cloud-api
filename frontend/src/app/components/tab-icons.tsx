import Profile from "./profile";
import TooltipWrapper from "./tooltip-wrapper";
import { useTab } from "../hooks/use-tab";
import TabIcon from "./tab-icon";
import { useProfile } from "../hooks/use-profile";
import {
  SignOutIcon,
  MoonIcon,
  SunIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";
import { useAuth } from "../hooks/use-auth";
import { useTranslations } from "../context/translation-provider";
import { useResponsive } from "../hooks/use-responsive";
import { useTheme } from "../hooks/use-theme";

export default function TabIcons() {
  const {
    profile: { avatarUrl, id, name },
  } = useProfile();
  const { selectedTab, selectTab, topTabs } = useTab();
  const { logout } = useAuth();
  const { t } = useTranslations();
  const { isMobile } = useResponsive();
  const { theme, toggleTheme } = useTheme();

  if (isMobile) {
    return (
      <section className="safe-area-bottom w-full border-t border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-mobile-nav))] shadow-[0_-8px_24px_rgb(38_35_43/0.06)]">
        <nav className="flex items-center justify-around gap-1 px-2 py-2">
          {topTabs.map((tab: string) => {
            const isSelected = selectedTab === tab;
            return (
              <button
                key={tab}
                onClick={() => selectTab(tab)}
                className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors sm:min-w-[76px] sm:flex-none sm:px-3 sm:text-xs ${
                  isSelected
                    ? "bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]"
                    : "text-[rgb(var(--text-secondary))]"
                }`}
                aria-label={t(`navigation.${tab}`)}
                type="button"
              >
                <TabIcon tab={tab} />
                <span className="max-w-full truncate">
                  {t(`navigation.${tab}`)}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => selectTab("profile")}
            className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors sm:min-w-[76px] sm:flex-none sm:px-3 sm:text-xs ${
              selectedTab === "profile"
                ? "bg-[rgb(var(--accent-primary)/0.12)] text-[rgb(var(--accent-primary))]"
                : "text-[rgb(var(--text-secondary))]"
            }`}
            aria-label={t("navigation.profile")}
            type="button"
          >
            <Profile
              url={avatarUrl}
              size="6"
              alt={name}
              seed={id ? parseInt(id, 10) : undefined}
            />
            <span className="max-w-full truncate">
              {t("navigation.profile")}
            </span>
          </button>
          <button
            onClick={toggleTheme}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium text-[rgb(var(--text-secondary))] transition-colors hover:bg-[rgb(var(--accent-hover)/var(--accent-hover-opacity))] sm:min-w-[76px] sm:flex-none sm:px-3 sm:text-xs"
            aria-label={t(
              theme === "dark"
                ? "navigation.lightTheme"
                : "navigation.darkTheme"
            )}
            type="button"
          >
            {theme === "dark" ? (
              <SunIcon className="size-5" weight="bold" />
            ) : (
              <MoonIcon className="size-5" weight="bold" />
            )}
            <span className="max-w-full truncate">
              {
                t(
                  theme === "dark"
                    ? "navigation.lightTheme"
                    : "navigation.darkTheme"
                ).split(" ")[0]
              }
            </span>
          </button>
        </nav>
      </section>
    );
  }

  return (
    <aside className="workspace-rail flex h-full min-h-0 w-full flex-col items-center justify-between py-4">
      <div className="flex flex-col items-center gap-6">
        <div
          className="flex size-10 items-center justify-center rounded-xl bg-[rgb(var(--accent-primary))] text-white shadow-[0_8px_18px_rgb(var(--accent-primary)/0.26)]"
          title={t("auth.title")}
        >
          <WhatsappLogoIcon className="size-6" weight="fill" />
        </div>
        <nav className="flex flex-col items-center gap-2">
          {topTabs.map((tab: string) => (
            <TooltipWrapper
              key={tab}
              selected={selectedTab === tab}
              onClick={() => selectTab(tab)}
              tab={t(`navigation.${tab}`)}
            >
              <TabIcon tab={tab} />
            </TooltipWrapper>
          ))}
        </nav>
      </div>

      <div className="flex flex-col items-center gap-2">
        <span className="my-1 h-px w-7 bg-[rgb(var(--border-primary)/var(--border-primary-opacity))]" />
        <TooltipWrapper
          tab={t(
            theme === "dark" ? "navigation.lightTheme" : "navigation.darkTheme"
          )}
          onClick={toggleTheme}
        >
          {theme === "dark" ? (
            <SunIcon className="size-5" weight="bold" />
          ) : (
            <MoonIcon className="size-5" weight="bold" />
          )}
        </TooltipWrapper>
        <TooltipWrapper tab={t("navigation.logout")} onClick={logout}>
          <SignOutIcon className="size-5" weight="bold" />
        </TooltipWrapper>
        <TooltipWrapper
          isProfile
          selected={selectedTab === "profile"}
          tab={t("navigation.profile")}
          onClick={() => selectTab("profile")}
        >
          <Profile
            url={avatarUrl}
            alt={name}
            seed={id ? parseInt(id, 10) : undefined}
          />
        </TooltipWrapper>
      </div>
    </aside>
  );
}
