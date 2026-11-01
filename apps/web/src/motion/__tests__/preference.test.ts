import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_UI_PREFS, effectiveMode, modeAvailability, nextTheme, resolveTheme, sanitizeUiPrefs, THEME_COLORS } from "../../app/state/uiPrefs";
import { isReducedMotion, loopAllowed, motionToggleView } from "../preference";

describe("motion preference", () => {
  it("is reduced when the OS asks or Lykia's switch is off", () => {
    assert.equal(isReducedMotion("on", false), false);
    assert.equal(isReducedMotion("off", false), true);
    assert.equal(isReducedMotion("on", true), true);
    assert.equal(isReducedMotion("off", true), true);
  });

  it("never offers to turn motion on against the OS setting", () => {
    const system = motionToggleView("on", true);
    assert.equal(system.checked, false);
    assert.equal(system.disabled, true);
    assert.match(system.description, /device/u);
    assert.deepEqual([motionToggleView("on", false).checked, motionToggleView("off", false).checked], [true, false]);
    assert.equal(motionToggleView("off", false).disabled, false);
  });

  it("runs loops only when allowed, visible, on screen and enabled", () => {
    assert.equal(loopAllowed({ reduced: false, visible: true }), true);
    assert.equal(loopAllowed({ reduced: true, visible: true }), false);
    assert.equal(loopAllowed({ reduced: false, visible: false }), false);
    assert.equal(loopAllowed({ reduced: false, visible: true, onScreen: false }), false);
    assert.equal(loopAllowed({ reduced: false, visible: true, enabled: false }), false);
  });
});

describe("ui preferences", () => {
  it("resolves the theme: explicit wins, system follows the device, dark when unknown", () => {
    assert.equal(resolveTheme("light", false), "light");
    assert.equal(resolveTheme("dark", true), "dark");
    assert.equal(resolveTheme("system", true), "light");
    assert.equal(resolveTheme("system", false), "dark");
    assert.equal(resolveTheme("system", null), "light", "unknown system: the DAY sheet");
    assert.equal(resolveTheme("system", false, "site"), "light", "the site is DAY unless chosen");
    assert.equal(resolveTheme("dark", true, "site"), "dark", "an explicit NIGHT wins on the site");
    assert.equal(resolveTheme("system", false, "app"), "dark", "the deck follows a dark system");
    assert.equal(nextTheme("system", true), "dark");
    assert.equal(nextTheme("dark", null), "light");
  });

  it("opens both Arc environments", () => {
    assert.equal(modeAvailability("testnet").available, true);
    assert.equal(modeAvailability("mainnet").available, true);
    assert.equal(effectiveMode("mainnet"), "mainnet");
    assert.equal(effectiveMode("testnet"), "testnet");
    assert.equal(effectiveMode("nonsense"), "testnet");
  });

  it("sanitises persisted state field by field", () => {
    assert.deepEqual(sanitizeUiPrefs(null), DEFAULT_UI_PREFS);
    assert.deepEqual(sanitizeUiPrefs({ theme: "light", motion: "off", mode: "mainnet", railCollapsed: true }), { theme: "light", motion: "off", mode: "mainnet", railCollapsed: true });
    assert.deepEqual(sanitizeUiPrefs({ theme: "neon", motion: 1, railCollapsed: "yes" }), DEFAULT_UI_PREFS);
  });
});

describe("browser chrome colour", () => {
  it("matches the Pixel Survey paper of each sheet (tokens.css)", () => {
    assert.equal(THEME_COLORS.light, "#F4EEE0");
    assert.equal(THEME_COLORS.dark, "#0C1417");
  });
});
