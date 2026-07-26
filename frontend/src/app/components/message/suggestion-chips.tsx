import { ArrowsClockwise } from "@phosphor-icons/react";
import { useTranslations } from "@/app/context/translation-provider";
import FormattedText from "./formatted-text";

type SuggestionChipsProps = {
  suggestions: string[];
  isLoading: boolean;
  onSelect: (suggestion: string) => void;
  onRefresh: () => void;
  disabled?: boolean;
};

export default function SuggestionChips({
  suggestions,
  isLoading,
  onSelect,
  onRefresh,
  disabled = false,
}: SuggestionChipsProps) {
  const { t } = useTranslations();
  const filteredSuggestions = suggestions.filter(
    (suggestion) => suggestion !== "NO_RESPONSE"
  );

  if (!isLoading && filteredSuggestions.length === 0) {
    return null;
  }

  return (
    <section className="mb-3 rounded-xl border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-secondary))] p-2.5">
      <header className="mb-2 flex items-center justify-between gap-3 px-1">
        <p className="text-xs font-semibold text-[rgb(var(--text-secondary))]">
          {t("chatInput.suggestedReplies")}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={disabled || isLoading}
          className="icon-action size-8 disabled:cursor-not-allowed disabled:opacity-50"
          title={t("chatInput.refreshSuggestions")}
          aria-label={t("chatInput.refreshSuggestions")}
        >
          <ArrowsClockwise
            className={`size-4 ${isLoading ? "animate-spin" : ""}`}
            weight="bold"
          />
        </button>
      </header>

      {isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <div className="h-9 w-full animate-pulse rounded-lg bg-[rgb(var(--bg-tertiary))]" />
          <span className="sr-only">{t("chatInput.suggestionsLoading")}</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={`${suggestion}-${index}`}
              type="button"
              onClick={() => onSelect(suggestion)}
              disabled={disabled}
              className="w-full rounded-lg border border-transparent bg-[rgb(var(--bg-card))] px-3 py-2.5 text-left text-sm leading-5 text-[rgb(var(--text-primary))] transition-colors hover:border-[rgb(var(--accent-primary)/0.25)] hover:bg-[rgb(var(--accent-hover)/var(--accent-hover-opacity))] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <FormattedText text={suggestion} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
