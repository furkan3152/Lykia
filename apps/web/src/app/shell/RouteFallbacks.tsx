import { RotateCcw } from "lucide-react";

import { Button } from "../../ui/Button";
import { Lyko } from "../../pixel/Lyko";
import { LykoLoader } from "../../pixel/LykoLoader";
import { LykiaMark } from "./LykiaMark";

/** Shown while a layout or page chunk loads for the first time: Lyko running the outrun. No spinner. */
export function BootFallback() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <LykoLoader label="Lyko is fetching the page" size="lg" />
    </div>
  );
}

/** A chunk failed to download (offline, or a new release replaced the files). */
export function RouteLoadFailed({ reload }: { readonly reload: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6" role="alert">
      <div className="flex max-w-md flex-col items-center gap-4 bg-card p-8 text-center px-frame px-drop-lg">
        <Lyko mood="alert" size={84} label={null} />
        <p className="font-display text-3xl font-bold text-ink">This page could not load</p>
        <p className="text-[15px] text-ink-2">Part of Lykia failed to download, usually because the connection dropped or a new version was released. Reload to try again.</p>
        <Button variant="primary" onClick={reload} leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}>
          Reload
        </Button>
      </div>
    </div>
  );
}

/** Lykia refuses to run inside another site's frame (clickjacking guard); no exceptions. */
export function FramedRouteNotice({ href }: { readonly href: string }) {
  return (
    <main id="main-content" className="flex min-h-[100dvh] items-center justify-center bg-paper p-4">
      <div className="flex max-w-md flex-col items-center gap-4 bg-card p-8 text-center px-frame px-drop-lg">
        <LykiaMark size={51} />
        <h1 className="font-display text-2xl font-bold text-ink">Lykia opens in its own tab</h1>
        <p className="text-[15px] text-ink-2">For your safety this page cannot run inside another website. Open it directly to continue.</p>
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center bg-accent px-4 font-display text-[15px] font-bold text-accent-ink px-frame px-drop px-press">
          Open Lykia
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </main>
  );
}
