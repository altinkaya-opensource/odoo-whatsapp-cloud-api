"use client";

import { PropsWithChildren } from "react";

type TooltipWrapperProps = {
  selected?: boolean;
  onClick?: () => void;
  isProfile?: boolean;
  tab?: string;
};

export default function TooltipWrapper({
  selected = false,
  isProfile = false,
  tab,
  onClick,
  children,
}: PropsWithChildren<TooltipWrapperProps>) {
  return (
    <button
      className={`icon-action relative ${isProfile ? "p-1" : "size-10"} ${
        selected
          ? "bg-[rgb(var(--accent-primary)/0.14)] text-[rgb(var(--accent-primary))] ring-1 ring-[rgb(var(--accent-primary)/0.2)]"
          : ""
      }`}
      onClick={onClick}
      title={tab}
      aria-label={tab}
      type="button"
    >
      {children}
    </button>
  );
}
