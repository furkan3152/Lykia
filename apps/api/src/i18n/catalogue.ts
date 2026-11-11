import type { MessageKey } from "./messages/en.js";

/** A full translation: every English key, each with its own text. A missing key fails the typecheck. */
export type Catalogue = Readonly<Record<MessageKey, string>>;
