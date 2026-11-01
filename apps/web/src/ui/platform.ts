/** True on macOS, iOS and iPadOS, where the command key is the modifier. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/iu.test(platform) || /Mac OS X/u.test(nav.userAgent);
}

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere. */
export function modShortcutLabel(key: string): string {
  return isApplePlatform() ? `⌘${key}` : `Ctrl ${key}`;
}
