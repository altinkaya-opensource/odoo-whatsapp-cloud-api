import { useTab } from "@/app/hooks/use-tab";
import { GearSixIcon } from "@phosphor-icons/react";
import CurrentChat from "./current-chat";
import { useTranslations } from "@/app/context/translation-provider";

export default function TabActivePanel() {
  const { selectedTab } = useTab();
  const { t } = useTranslations();

  if (selectedTab === "chats") {
    return (
      <section className="workspace-conversation h-full min-h-0 w-full">
        <CurrentChat />
      </section>
    );
  }

  return (
    <section className="workspace-conversation flex h-full min-h-0 w-full flex-col items-center justify-center gap-4 px-6">
      <GearSixIcon className="size-10 text-[rgb(var(--text-secondary))]" />
      <p className="text-[rgb(var(--text-primary))] text-3xl capitalize">
        {t(`navigation.${selectedTab}`)}
      </p>
    </section>
  );
}
