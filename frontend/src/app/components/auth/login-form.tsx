"use client";

import {
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
  useRef,
  useState,
} from "react";
import { useAuth } from "@/app/hooks/use-auth";
import { useTranslations } from "@/app/context/translation-provider";

const TOTP_CODE_LENGTH = 6;

const createEmptyTotpDigits = () =>
  Array.from({ length: TOTP_CODE_LENGTH }, () => "");

export default function LoginForm() {
  const { login, loginWithSessionId, verifyTotp, isAuthenticating } = useAuth();
  const [loginMode, setLoginMode] = useState<"credentials" | "sessionId">(
    "credentials"
  );
  const [isTotpStep, setIsTotpStep] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [totpDigits, setTotpDigits] = useState(createEmptyTotpDigits);
  const [error, setError] = useState<string | null>(null);
  const totpInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const { t } = useTranslations();

  const resolveErrorMessage = (err: unknown) => {
    const message = err instanceof Error ? err.message : t("auth.submitError");

    switch (message) {
      case "totp_invalid":
        return t("auth.totpInvalid");
      case "totp_expired":
        return t("auth.totpExpired");
      case "totp_invalid_format":
        return t("auth.totpCodeRequired");
      case "totp_unavailable":
        return t("auth.totpUnavailable");
      default:
        return message;
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      if (isTotpStep) {
        await verifyTotp(totpDigits.join(""));
      } else if (loginMode === "sessionId") {
        await loginWithSessionId(sessionId.trim());
      } else {
        const result = await login(username.trim(), password);
        if (result.totpRequired) {
          setPassword("");
          setTotpDigits(createEmptyTotpDigits());
          setIsTotpStep(true);
        }
      }
    } catch (err) {
      setError(resolveErrorMessage(err));
    }
  };

  const handleBackFromTotp = () => {
    setError(null);
    setTotpDigits(createEmptyTotpDigits());
    setIsTotpStep(false);
  };

  const focusTotpInput = (index: number) => {
    totpInputRefs.current[index]?.focus();
  };

  const setTotpDigitsFrom = (startIndex: number, rawValue: string) => {
    const incomingDigits = rawValue
      .replace(/\D/g, "")
      .slice(0, TOTP_CODE_LENGTH - startIndex);

    if (!incomingDigits) {
      setTotpDigits((current) => {
        const next = [...current];
        next[startIndex] = "";
        return next;
      });
      return;
    }

    setTotpDigits((current) => {
      const next = [...current];
      incomingDigits.split("").forEach((digit, offset) => {
        next[startIndex + offset] = digit;
      });
      return next;
    });

    focusTotpInput(
      Math.min(startIndex + incomingDigits.length, TOTP_CODE_LENGTH - 1)
    );
  };

  const handleTotpPaste = (
    index: number,
    event: ClipboardEvent<HTMLInputElement>
  ) => {
    event.preventDefault();
    setTotpDigitsFrom(index, event.clipboardData.getData("text"));
  };

  const handleTotpKeyDown = (
    index: number,
    event: KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      focusTotpInput(index - 1);
      return;
    }

    if (event.key === "ArrowRight" && index < TOTP_CODE_LENGTH - 1) {
      event.preventDefault();
      focusTotpInput(index + 1);
      return;
    }

    if (event.key === "Backspace" && !totpDigits[index] && index > 0) {
      event.preventDefault();
      setTotpDigits((current) => {
        const next = [...current];
        next[index - 1] = "";
        return next;
      });
      focusTotpInput(index - 1);
    }
  };

  const isSubmitDisabled = isTotpStep
    ? totpDigits.some((digit) => !digit) || isAuthenticating
    : loginMode === "sessionId"
      ? sessionId.trim().length === 0 || isAuthenticating
      : username.trim().length === 0 ||
        password.length === 0 ||
        isAuthenticating;

  return (
    <form
      className="flex w-full flex-col gap-5"
      onSubmit={handleSubmit}
      noValidate
    >
      {!isTotpStep && (
        <div className="flex gap-1 rounded-xl border border-[rgb(var(--border-primary)/var(--border-primary-opacity))] bg-[rgb(var(--bg-secondary))] p-1">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setLoginMode("credentials");
            }}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
              loginMode === "credentials"
                ? "bg-[rgb(var(--bg-card))] text-[rgb(var(--accent-primary))] shadow-sm"
                : "text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))]"
            }`}
          >
            {t("auth.loginModeCredentials")}
          </button>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setLoginMode("sessionId");
            }}
            className={`flex-1 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors ${
              loginMode === "sessionId"
                ? "bg-[rgb(var(--bg-card))] text-[rgb(var(--accent-primary))] shadow-sm"
                : "text-[rgb(var(--text-secondary))] hover:text-[rgb(var(--text-primary))]"
            }`}
          >
            {t("auth.loginModeSessionId")}
          </button>
        </div>
      )}

      {isTotpStep ? (
        <div className="rounded-2xl border border-[rgb(var(--accent-primary)/0.2)] bg-[rgb(var(--accent-primary)/0.06)] p-4">
          <h3 className="text-base font-semibold text-[rgb(var(--text-primary))]">
            {t("auth.totpTitle")}
          </h3>
          <p
            className="mt-1 text-sm leading-6 text-[rgb(var(--text-secondary))]"
            id="totp-description"
          >
            {t("auth.totpDescription")}
          </p>
          <p
            className="mt-4 block text-sm font-semibold text-[rgb(var(--text-primary))]"
            id="totp-code-label"
          >
            {t("auth.totpCode")}
          </p>
          <div
            aria-describedby={
              error ? "totp-description totp-error" : "totp-description"
            }
            aria-labelledby="totp-code-label"
            className="mt-3 grid grid-cols-6 gap-1.5 sm:gap-2"
            role="group"
          >
            {totpDigits.map((digit, index) => (
              <input
                aria-invalid={Boolean(error)}
                aria-label={t("auth.totpCodeDigit", { digit: index + 1 })}
                autoComplete={index === 0 ? "one-time-code" : "off"}
                autoFocus={index === 0}
                className="control-field h-12 min-w-0 px-0 text-center font-mono text-xl font-semibold tabular-nums sm:h-14 sm:text-2xl"
                inputMode="numeric"
                key={index}
                maxLength={TOTP_CODE_LENGTH - index}
                name={`totpCode-${index + 1}`}
                onChange={(event) =>
                  setTotpDigitsFrom(index, event.target.value)
                }
                onFocus={(event) => event.currentTarget.select()}
                onKeyDown={(event) => handleTotpKeyDown(index, event)}
                onPaste={(event) => handleTotpPaste(index, event)}
                pattern="[0-9]*"
                ref={(element) => {
                  totpInputRefs.current[index] = element;
                }}
                type="text"
                value={digit}
              />
            ))}
          </div>
        </div>
      ) : loginMode === "credentials" ? (
        <>
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-semibold text-[rgb(var(--text-primary))]"
              htmlFor="username"
            >
              {t("auth.username")}
            </label>
            <input
              id="username"
              name="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="control-field w-full px-3.5 py-3 placeholder-[rgb(var(--text-secondary)/var(--text-quaternary-opacity))]"
              placeholder={t("auth.username")}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label
              className="text-sm font-semibold text-[rgb(var(--text-primary))]"
              htmlFor="password"
            >
              {t("auth.password")}
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="control-field w-full px-3.5 py-3 placeholder-[rgb(var(--text-secondary)/var(--text-quaternary-opacity))]"
              placeholder={t("auth.password")}
            />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2">
          <label
            className="text-sm font-semibold text-[rgb(var(--text-primary))]"
            htmlFor="sessionId"
          >
            {t("auth.sessionIdLabel")}
          </label>
          <textarea
            id="sessionId"
            name="sessionId"
            rows={3}
            value={sessionId}
            onChange={(event) => setSessionId(event.target.value)}
            className="control-field w-full resize-none px-3.5 py-3 font-mono text-xs placeholder-[rgb(var(--text-secondary)/var(--text-quaternary-opacity))]"
            placeholder={t("auth.sessionIdPlaceholder")}
          />
          <p className="text-xs text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))]">
            {t("auth.sessionIdHelp")
              .split("<code>")
              .map((part, i) => {
                if (i === 0) return part;
                const [codeContent, ...rest] = part.split("</code>");
                return (
                  <span key={i}>
                    <code className="rounded bg-[rgb(var(--bg-secondary))] px-1 py-0.5">
                      {codeContent}
                    </code>
                    {rest.join("</code>")}
                  </span>
                );
              })}
          </p>
        </div>
      )}

      {error && (
        <p
          className="rounded-xl border border-[rgb(var(--status-error)/0.3)] bg-[rgb(var(--status-error)/0.1)] p-3 text-sm text-[rgb(var(--status-error))]"
          id={isTotpStep ? "totp-error" : undefined}
          role="alert"
        >
          {error}
        </p>
      )}
      {isTotpStep && (
        <button
          className="secondary-action w-full px-4 py-3 text-sm font-semibold"
          onClick={handleBackFromTotp}
          type="button"
        >
          {t("auth.totpBack")}
        </button>
      )}
      <button
        type="submit"
        className="primary-action w-full px-4 py-3.5 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isSubmitDisabled}
      >
        {isAuthenticating
          ? isTotpStep
            ? t("auth.totpVerifying")
            : t("auth.submitting")
          : isTotpStep
            ? t("auth.totpVerify")
            : t("auth.submit")}
      </button>
    </form>
  );
}
