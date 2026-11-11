// Must stay the first import (see the module).
import "./app/state/bootstrapStorage";

import { loadLocale, preferredLocale } from "./i18n";

// The interface language loads first (English is bundled; the others are one chunk each), then the app.
void loadLocale(preferredLocale())
  .catch(() => loadLocale("en"))
  .finally(() => void import("./app/boot"));
