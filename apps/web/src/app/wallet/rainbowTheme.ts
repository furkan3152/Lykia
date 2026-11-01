import { darkTheme, lightTheme } from "@rainbow-me/rainbowkit";

import type { ResolvedTheme } from "../state/uiPrefs";

const FONT = '"Inter Variable", Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

/** RainbowKit's concrete theme shape (its exported `Theme` also allows a light/dark pair). */
type ThemeVars = ReturnType<typeof darkTheme>;

const RADII: ThemeVars["radii"] = {
  actionButton: "12px",
  connectButton: "12px",
  menuButton: "12px",
  modal: "24px",
  modalMobile: "24px",
};

/**
 * RainbowKit in Lykia's palette: violet accent (purple light), gold for the
 * selected and pending highlights (their own sun), the kit's radii, Inter.
 * RainbowKit cannot read CSS variables, so the hex values mirror tokens.css.
 */
export function lykiaRainbowTheme(theme: ResolvedTheme): ThemeVars {
  if (theme === "light") {
    const base = lightTheme({ accentColor: "#6D3FE0", accentColorForeground: "#FFFFFF", borderRadius: "large", fontStack: "system", overlayBlur: "small" });
    return {
      ...base,
      colors: {
        ...base.colors,
        modalBackground: "#FFFFFF",
        modalBorder: "rgba(28, 23, 48, 0.12)",
        modalText: "#1C1730",
        modalTextSecondary: "#4A4366",
        modalTextDim: "#6E6787",
        modalBackdrop: "rgba(28, 23, 48, 0.36)",
        generalBorder: "rgba(28, 23, 48, 0.10)",
        generalBorderDim: "rgba(28, 23, 48, 0.06)",
        actionButtonSecondaryBackground: "#F3EEE4",
        closeButton: "#4A4366",
        closeButtonBackground: "#F3EEE4",
        connectButtonBackground: "#FFFFFF",
        connectButtonInnerBackground: "#F3EEE4",
        connectButtonText: "#1C1730",
        menuItemBackground: "#F3EEE4",
        profileAction: "#F3EEE4",
        profileActionHover: "#EAE3D6",
        profileForeground: "#FFFFFF",
        selectedOptionBorder: "rgba(183, 128, 26, 0.65)",
        standby: "#B7801A",
        error: "#C7325A",
        connectionIndicator: "#08785C",
        downloadTopCardBackground: "#FBF8F2",
        downloadBottomCardBackground: "#F3EEE4",
      },
      fonts: { body: FONT },
      radii: RADII,
      shadows: { ...base.shadows, dialog: "0 24px 60px -20px rgba(28, 23, 48, 0.25)" },
    };
  }
  const base = darkTheme({ accentColor: "#8B5CF6", accentColorForeground: "#FFFFFF", borderRadius: "large", fontStack: "system", overlayBlur: "small" });
  return {
    ...base,
    colors: {
      ...base.colors,
      modalBackground: "#0E0C18",
      modalBorder: "rgba(196, 181, 253, 0.18)",
      modalText: "#F4F1FF",
      modalTextSecondary: "#B9B3D6",
      modalTextDim: "#7C7699",
      modalBackdrop: "rgba(4, 3, 9, 0.66)",
      generalBorder: "rgba(196, 181, 253, 0.11)",
      generalBorderDim: "rgba(196, 181, 253, 0.06)",
      actionButtonSecondaryBackground: "#161328",
      closeButton: "#B9B3D6",
      closeButtonBackground: "#161328",
      connectButtonBackground: "#0E0C18",
      connectButtonInnerBackground: "#161328",
      connectButtonText: "#F4F1FF",
      menuItemBackground: "#1F1B38",
      profileAction: "#161328",
      profileActionHover: "#1F1B38",
      profileForeground: "#0E0C18",
      selectedOptionBorder: "rgba(245, 198, 107, 0.65)",
      standby: "#F5C66B",
      error: "#FF6B8B",
      connectionIndicator: "#5EF2C4",
      downloadTopCardBackground: "#161328",
      downloadBottomCardBackground: "#0E0C18",
    },
    fonts: { body: FONT },
    radii: RADII,
    shadows: { ...base.shadows, dialog: "0 24px 60px -20px rgba(0, 0, 0, 0.7)" },
  };
}
