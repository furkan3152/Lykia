import React from "react";

import { cx } from "../../ui/cx";

export { Page, type PageProps } from "../../pixel/layout";

export interface PageHeaderProps {
  readonly title: React.ReactNode;
  /** The tag chip above the title ("ROUTE CARD · 3 WAYPOINTS"). */
  readonly eyebrow?: React.ReactNode;
  readonly description?: React.ReactNode;
  /** Centred under the description: the page's actions. */
  readonly actions?: React.ReactNode;
  readonly className?: string;
}

/** Page header (Pixel Survey): centred on the axis, tag chip, Pixelify headline, one line of description, actions. */
export function PageHeader({ title, eyebrow, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cx("mx-auto mb-10 flex max-w-[860px] flex-col items-center text-center sm:mb-12", className)}>
      {eyebrow ? <p className="label-tab mb-5">{eyebrow}</p> : null}
      <h1 className="font-display text-display-lg font-bold text-ink">{title}</h1>
      {description ? <p className="mt-4 max-w-[640px] text-[17px] leading-relaxed text-ink-2 text-pretty">{description}</p> : null}
      {actions ? <div className="mt-6 flex flex-wrap items-center justify-center gap-4">{actions}</div> : null}
    </div>
  );
}
