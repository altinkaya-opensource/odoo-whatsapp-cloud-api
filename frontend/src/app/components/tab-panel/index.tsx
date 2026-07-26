import { useTab } from "@/app/hooks/use-tab";
import Chats from "./chats";
import { useTranslations } from "@/app/context/translation-provider";
import { useProfile } from "@/app/hooks/use-profile";
import { GearSixIcon } from "@phosphor-icons/react";
import Profile from "../profile";
import SettingsPanel from "../settings-panel";

export default function TabPanelSwitcher() {
  const { selectedTab, selectTab } = useTab();
  const { t } = useTranslations();
  const {
    profile: { avatarUrl, id, name },
  } = useProfile();

  if (selectedTab === "chats") {
    return <Chats selectedTab={selectedTab} />;
  }

  if (selectedTab === "settings") {
    return <SettingsPanel />;
  }

  if (selectedTab === "profile") {
    return (
      <section className="flex h-full min-h-0 w-full flex-col gap-5 p-5">
        <header className="flex w-full items-center justify-between">
          <h1 className="text-xl font-semibold tracking-[-0.025em] text-[rgb(var(--text-primary))]">
            {t("navigation.profile")}
          </h1>
        </header>
        <section className="surface-card flex w-full flex-col gap-5 rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <Profile
              size="12"
              url={avatarUrl}
              alt={name}
              seed={id ? Number(id) : undefined}
            />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-[rgb(var(--text-primary))]">
                {name}
              </p>
              <p className="mt-1 text-sm leading-5 text-[rgb(var(--text-secondary))]">
                {t("profile.identityDescription")}
              </p>
            </div>
          </div>
          <button
            className="secondary-action flex w-full items-center justify-center gap-2 px-3 py-2.5 text-sm font-semibold"
            onClick={() => selectTab("settings")}
            type="button"
          >
            <GearSixIcon className="size-4" weight="bold" />
            {t("profile.openSettings")}
          </button>
        </section>
      </section>
    );
  }

  return (
    <div className="p-5 text-[rgb(var(--text-primary))]">
      {t("common.comingSoon")}
    </div>
  );
}
