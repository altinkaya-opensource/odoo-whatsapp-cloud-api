import { useCurrentChat } from "@/app/hooks/use-current-chat";
import Profile from "../profile";
import { ArrowLeftIcon, ImagesIcon } from "@phosphor-icons/react";
import { useTranslations } from "@/app/context/translation-provider";
import { useMobileNavigation } from "@/app/context/mobile-navigation-provider";
import { useResponsive } from "@/app/hooks/use-responsive";
import { useAuth } from "@/app/hooks/use-auth";

type ContactHeaderProps = {
  onOpenMedia: () => void;
};

export default function ContactHeader({ onOpenMedia }: ContactHeaderProps) {
  const {
    threadName,
    phoneNumber,
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
    partnerName ?? threadName ?? phoneNumber ?? t("context.unknownContact");

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

  return (
    <header className="flex w-full items-center gap-3 border-b border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-card))] px-4 py-3 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        {renderBackButton()}
        <Profile
          size="10"
          url={hasAvatar ? (partnerAvatar ?? undefined) : undefined}
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
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenMedia}
        className="icon-action ml-auto size-10 shrink-0"
        aria-label={t("gallery.title")}
        title={t("gallery.title")}
      >
        <ImagesIcon className="size-5" weight="bold" />
      </button>
    </header>
  );
}
