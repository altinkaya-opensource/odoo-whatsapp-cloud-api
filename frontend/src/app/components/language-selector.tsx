"use client";

import { useTranslations } from "@/app/context/translation-provider";

const SUPPORTED_LOCALES = [
  { value: "en", label: "English" },
  { value: "tr", label: "Türkçe" },
] as const;

export default function LanguageSelector() {
  const { locale, setLocale, t } = useTranslations();

  return (
    <div className="flex flex-col items-start gap-2">
      <label
        className="text-sm font-semibold text-[rgb(var(--text-primary))]"
        htmlFor="language-selector"
      >
        {t("navigation.language")}
      </label>
      <select
        id="language-selector"
        className="control-field w-full px-3 py-2.5 text-sm"
        value={locale}
        onChange={(event) =>
          setLocale(
            event.target.value as (typeof SUPPORTED_LOCALES)[number]["value"]
          )
        }
      >
        {SUPPORTED_LOCALES.map(({ value, label }) => (
          <option
            key={value}
            value={value}
            className="text-[rgb(var(--text-primary))] bg-[rgb(var(--bg-primary))]"
          >
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
