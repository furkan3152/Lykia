import { installMemoryStorageFallback } from "./storage";

/*
 * Imported first by main.tsx (imports are hoisted, so this must be a module of
 * its own): a browser that refuses site data gets in-memory storage before
 * the ui store hydrates or any wallet library touches window.localStorage.
 */
installMemoryStorageFallback();
