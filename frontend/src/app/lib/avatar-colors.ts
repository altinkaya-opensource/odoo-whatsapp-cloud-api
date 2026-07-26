export type AvatarSeed = number | string;

type AvatarColor = {
  background: string;
  foreground: string;
};

const DARK_AVATAR_COLORS: AvatarColor[] = [
  { background: "hsl(214 25% 29%)", foreground: "hsl(210 40% 96%)" },
  { background: "hsl(163 27% 27%)", foreground: "hsl(156 42% 95%)" },
  { background: "hsl(33 28% 30%)", foreground: "hsl(42 54% 96%)" },
  { background: "hsl(278 21% 31%)", foreground: "hsl(276 36% 96%)" },
  { background: "hsl(4 27% 31%)", foreground: "hsl(10 46% 96%)" },
  { background: "hsl(196 24% 28%)", foreground: "hsl(195 43% 96%)" },
];

const LIGHT_AVATAR_COLORS: AvatarColor[] = [
  { background: "hsl(214 40% 87%)", foreground: "hsl(215 35% 20%)" },
  { background: "hsl(163 35% 85%)", foreground: "hsl(163 38% 18%)" },
  { background: "hsl(38 44% 86%)", foreground: "hsl(31 41% 19%)" },
  { background: "hsl(278 31% 88%)", foreground: "hsl(278 30% 21%)" },
  { background: "hsl(5 39% 87%)", foreground: "hsl(5 39% 21%)" },
  { background: "hsl(196 37% 86%)", foreground: "hsl(198 37% 19%)" },
];

function hashSeed(seed: AvatarSeed): number {
  return Array.from(String(seed)).reduce(
    (hash, character) => ((hash << 5) - hash + character.codePointAt(0)!) | 0,
    0
  );
}

/**
 * Creates a stable, quiet identity color for a missing person photo. The pair
 * is deliberately flat so initials stay legible at every avatar size.
 */
export function getAvatarColors(
  seed: AvatarSeed,
  theme: "dark" | "light"
): AvatarColor {
  const palette = theme === "dark" ? DARK_AVATAR_COLORS : LIGHT_AVATAR_COLORS;
  const colorIndex = Math.abs(hashSeed(seed)) % palette.length;

  return palette[colorIndex] ?? palette[0]!;
}

/** Kept for callers that only need the background color. */
export function generateAvatarColor(
  seed: AvatarSeed,
  theme: "dark" | "light"
): string {
  return getAvatarColors(seed, theme).background;
}
