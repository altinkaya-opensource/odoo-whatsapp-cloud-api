import {
  createContext,
  type Dispatch,
  PropsWithChildren,
  type SetStateAction,
  useCallback,
  useContext,
  useMemo,
  useEffect,
  useState,
} from "react";

export const THEMES = ["dark", "light"] as const;
export const COLOR_SCHEMES = ["plum", "cobalt", "verdant"] as const;
export const BACKGROUNDS = ["soft", "grid", "plain"] as const;
export const TEXT_SIZES = ["compact", "comfortable", "large"] as const;

export type Theme = (typeof THEMES)[number];
export type ColorScheme = (typeof COLOR_SCHEMES)[number];
export type WorkspaceBackground = (typeof BACKGROUNDS)[number];
export type TextSize = (typeof TEXT_SIZES)[number];

type AppearancePreferences = {
  colorScheme: ColorScheme;
  background: WorkspaceBackground;
  textSize: TextSize;
};

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  colorScheme: ColorScheme;
  setColorScheme: Dispatch<SetStateAction<ColorScheme>>;
  background: WorkspaceBackground;
  setBackground: Dispatch<SetStateAction<WorkspaceBackground>>;
  textSize: TextSize;
  setTextSize: Dispatch<SetStateAction<TextSize>>;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const DEFAULT_THEME: Theme = "dark";
const DEFAULT_APPEARANCE: AppearancePreferences = {
  colorScheme: "plum",
  background: "soft",
  textSize: "comfortable",
};
const STORAGE_KEY = "app.theme";
const APPEARANCE_STORAGE_KEY = "app.appearance";

const ACCENT_TOKENS: Record<
  ColorScheme,
  Record<Theme, { primary: string; active: string; hover: string }>
> = {
  plum: {
    dark: {
      primary: "125 91 118",
      active: "163 121 153",
      hover: "125 91 118",
    },
    light: {
      primary: "113 75 103",
      active: "89 54 82",
      hover: "113 75 103",
    },
  },
  cobalt: {
    dark: {
      primary: "88 144 231",
      active: "129 176 243",
      hover: "88 144 231",
    },
    light: {
      primary: "37 104 190",
      active: "24 78 151",
      hover: "37 104 190",
    },
  },
  verdant: {
    dark: {
      primary: "54 177 127",
      active: "91 207 157",
      hover: "54 177 127",
    },
    light: {
      primary: "20 135 85",
      active: "13 108 67",
      hover: "20 135 85",
    },
  },
};

const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && THEMES.includes(value as Theme);

const isColorScheme = (value: unknown): value is ColorScheme =>
  typeof value === "string" && COLOR_SCHEMES.includes(value as ColorScheme);

const isBackground = (value: unknown): value is WorkspaceBackground =>
  typeof value === "string" &&
  BACKGROUNDS.includes(value as WorkspaceBackground);

const isTextSize = (value: unknown): value is TextSize =>
  typeof value === "string" && TEXT_SIZES.includes(value as TextSize);

export function ThemeProvider({ children }: PropsWithChildren) {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);
  const [colorScheme, setColorScheme] = useState<ColorScheme>(
    DEFAULT_APPEARANCE.colorScheme
  );
  const [background, setBackground] = useState<WorkspaceBackground>(
    DEFAULT_APPEARANCE.background
  );
  const [textSize, setTextSize] = useState<TextSize>(
    DEFAULT_APPEARANCE.textSize
  );
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedTheme = window.localStorage.getItem(STORAGE_KEY);
    if (isTheme(storedTheme)) {
      setTheme(storedTheme);
    }

    const storedAppearance = window.localStorage.getItem(
      APPEARANCE_STORAGE_KEY
    );
    if (storedAppearance) {
      try {
        const parsed = JSON.parse(
          storedAppearance
        ) as Partial<AppearancePreferences>;
        if (isColorScheme(parsed.colorScheme)) {
          setColorScheme(parsed.colorScheme);
        }
        if (isBackground(parsed.background)) {
          setBackground(parsed.background);
        }
        if (isTextSize(parsed.textSize)) {
          setTextSize(parsed.textSize);
        }
      } catch {
        window.localStorage.removeItem(APPEARANCE_STORAGE_KEY);
      }
    }

    setIsInitialized(true);
  }, []);

  useEffect(() => {
    if (!isInitialized) {
      return;
    }

    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, theme);
      window.localStorage.setItem(
        APPEARANCE_STORAGE_KEY,
        JSON.stringify({ colorScheme, background, textSize })
      );

      document.documentElement.setAttribute("data-theme", theme);
      document.documentElement.setAttribute("data-background", background);
      document.documentElement.setAttribute("data-text-size", textSize);

      const accent = ACCENT_TOKENS[colorScheme][theme];
      document.documentElement.style.setProperty(
        "--accent-primary",
        accent.primary
      );
      document.documentElement.style.setProperty(
        "--accent-active",
        accent.active
      );
      document.documentElement.style.setProperty(
        "--accent-hover",
        accent.hover
      );
    }
  }, [background, colorScheme, isInitialized, textSize, theme]);

  const changeTheme = useCallback((nextTheme: Theme) => {
    if (nextTheme === "dark" || nextTheme === "light") {
      setTheme(nextTheme);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const contextValue = useMemo(
    () => ({
      theme,
      setTheme: changeTheme,
      toggleTheme,
      colorScheme,
      setColorScheme,
      background,
      setBackground,
      textSize,
      setTextSize,
    }),
    [background, changeTheme, colorScheme, textSize, theme, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
