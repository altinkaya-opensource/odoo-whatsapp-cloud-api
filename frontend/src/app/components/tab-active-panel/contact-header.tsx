import { Contact } from "@/app/context/contacts-provider";
import { useCurrentChat } from "@/app/hooks/use-current-chat";
import { useProfile } from "@/app/hooks/use-profile";
import Profile from "../profile";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useTranslations } from "@/app/context/translation-provider";
import { useMobileNavigation } from "@/app/context/mobile-navigation-provider";
import { useResponsive } from "@/app/hooks/use-responsive";
import { useAuth } from "@/app/hooks/use-auth";

export default function ContactHeader() {
  const {
    profile: { id },
  } = useProfile();
  const {
    contact,
    group,
    threadName,
    partnerId,
    partnerName,
    partnerAvatar,
    hasAvatar,
    backendId,
  } = useCurrentChat();
  const { backendNames } = useAuth();
  const { t } = useTranslations();
  const backendName = backendId ? backendNames[backendId] : null;
  const { showChatList } = useMobileNavigation();
  const { isMobile } = useResponsive();
  const displayName =
    partnerName ?? contact?.displayName ?? threadName ?? t("chatList.title");

  const renderContactStatus = () => {
    if (!contact?.typing) {
      return null;
    }

    return (
      <p className="mt-0.5 text-xs font-medium text-[rgb(var(--status-success))]">
        {t("chat.statusTyping")}
      </p>
    );
  };

  const renderBackButton = () => {
    if (!isMobile) {
      return null;
    }

    return (
      <button
        onClick={showChatList}
        className="icon-action size-10 shrink-0"
        aria-label={t("chat.backToChats")}
        type="button"
      >
        <ArrowLeftIcon className="size-5" weight="bold" />
      </button>
    );
  };

  if (group) {
    const groupMembers = Object.values(group.contacts)
      .map((groupContact?: Contact) =>
        groupContact?.id === id ? t("common.you") : groupContact?.displayName
      )
      .filter(Boolean)
      .join(", ");

    return (
      <header className="flex w-full items-center gap-3 border-b border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-card))] px-4 py-3 md:px-5">
        <div className="flex min-w-0 items-center gap-3">
          {renderBackButton()}
          <Profile
            size="10"
            url={group.avatar || undefined}
            alt={group.name}
            kind="group"
          />
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate text-sm font-semibold text-[rgb(var(--text-primary))]">
                {group.name}
              </p>
              {backendName && (
                <span className="hidden shrink-0 rounded-md bg-[rgb(var(--bg-secondary))] px-2 py-1 text-[11px] font-medium text-[rgb(var(--text-secondary))] sm:inline">
                  {backendName}
                </span>
              )}
            </div>
            {groupMembers && (
              <p className="mt-0.5 truncate text-xs text-[rgb(var(--text-secondary))]">
                {groupMembers}
              </p>
            )}
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="flex w-full items-center gap-3 border-b border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-card))] px-4 py-3 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {renderBackButton()}
        <Profile
          size="10"
          url={
            hasAvatar
              ? (partnerAvatar ?? contact?.contactAvatar ?? undefined)
              : undefined
          }
          alt={displayName}
          seed={partnerId ?? undefined}
        />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold text-[rgb(var(--text-primary))]">
              {displayName}
            </p>
            {backendName && (
              <span className="hidden shrink-0 rounded-md bg-[rgb(var(--bg-secondary))] px-2 py-1 text-[11px] font-medium text-[rgb(var(--text-secondary))] sm:inline">
                {backendName}
              </span>
            )}
          </div>
          {renderContactStatus()}
        </div>
      </div>
    </header>
  );
}
