"use client";

import { UserIcon, UsersThreeIcon } from "@phosphor-icons/react";
import Image from "next/image";
import { PropsWithChildren, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/app/context/theme-provider";
import { getAvatarColors, type AvatarSeed } from "@/app/lib/avatar-colors";

type ProfileKind = "person" | "group";

function getInitials(label: string | undefined) {
  const normalizedLabel = label?.trim();

  if (!normalizedLabel || normalizedLabel.toLowerCase() === "profile") {
    return null;
  }

  const words = normalizedLabel
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter((word) => /\p{L}/u.test(word));

  if (!words?.length) {
    return null;
  }

  if (words.length === 1) {
    return words[0]?.slice(0, 1).toLocaleUpperCase() ?? null;
  }

  return `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`.toLocaleUpperCase();
}

export default function Profile({
  children,
  size,
  url,
  alt = "profile",
  seed,
  kind = "person",
}: PropsWithChildren<{
  size?: string;
  url?: string;
  alt?: string;
  seed?: AvatarSeed;
  kind?: ProfileKind;
}>) {
  const [imageError, setImageError] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const initials = getInitials(alt);
  const fallbackSeed = seed ?? (initials ? alt : "anonymous");
  const avatarColors = useMemo(
    () => getAvatarColors(fallbackSeed, theme),
    [fallbackSeed, theme]
  );

  const sizeClass =
    {
      6: "size-6",
      7: "size-7",
      8: "size-8",
      10: "size-10",
      11: "size-11",
      12: "size-12",
    }[size ?? 7] ?? "size-7";

  useEffect(() => {
    if (!url) {
      setImageError(false);
      setImageLoaded(false);
      return;
    }

    setImageError(false);
    setImageLoaded(false);

    const imageElement = imageContainerRef.current?.querySelector("img");
    if (imageElement?.complete) {
      setImageLoaded(true);
    }
  }, [url]);

  const renderFallback = () => {
    if (kind === "group") {
      return (
        <div className="flex size-full items-center justify-center bg-[rgb(var(--accent-primary)/0.14)] text-[rgb(var(--accent-primary))]">
          <UsersThreeIcon className="size-[58%]" weight="fill" />
        </div>
      );
    }

    return (
      <div
        className="flex size-full items-center justify-center"
        style={{ backgroundColor: avatarColors.background }}
      >
        {initials ? (
          <span
            className="text-[0.68em] font-semibold leading-none"
            style={{ color: avatarColors.foreground }}
          >
            {initials}
          </span>
        ) : (
          <UserIcon
            className="size-[54%]"
            style={{ color: avatarColors.foreground }}
            weight="fill"
          />
        )}
      </div>
    );
  };

  const renderAvatar = () => {
    if (!url || imageError) {
      return renderFallback();
    }

    return (
      <div ref={imageContainerRef} className="relative size-full">
        {!imageLoaded && (
          <div className="absolute inset-0 animate-pulse bg-[rgb(var(--bg-tertiary))]" />
        )}
        <Image
          src={url}
          alt={alt}
          fill
          className={`object-cover object-center transition-opacity duration-150 ${
            imageLoaded ? "opacity-100" : "opacity-0"
          }`}
          unoptimized={true}
          onLoad={() => setImageLoaded(true)}
          onError={() => {
            setImageError(true);
            setImageLoaded(false);
          }}
        />
      </div>
    );
  };

  return (
    <span
      className={`${sizeClass} inline-flex shrink-0 overflow-hidden rounded-full border border-[rgb(var(--border-primary)/0.52)] bg-[rgb(var(--bg-tertiary))]`}
    >
      {children ?? renderAvatar()}
    </span>
  );
}
