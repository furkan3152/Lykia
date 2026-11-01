import React from "react";

import { buttonClasses, type ButtonSize, type ButtonVariant } from "./buttonStyles";

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Accessible name; also the native tooltip. Required: an icon alone says nothing to a screen reader. */
  readonly label: string;
  readonly icon: React.ReactNode;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Shows the label as a native tooltip (default true). */
  readonly showTitle?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = "ghost", size = "md", showTitle = true, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={showTitle ? label : undefined}
      className={buttonClasses({ variant, size, iconOnly: true, className })}
      {...rest}
    >
      {icon}
    </button>
  );
});
