import React from "react";

import { Link, type LinkProps } from "../app/routes/Link";
import { Blaze } from "../topo/Blaze";
import type { Grade } from "../topo/geometry/conditions";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "./buttonStyles";
import { ContourLoader } from "./ContourLoader";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  /** Draws a contour loader in place of the left icon, keeps the width and blocks clicks. */
  readonly loading?: boolean;
  readonly leftIcon?: React.ReactNode;
  readonly rightIcon?: React.ReactNode;
  /** Route grade (T1-T6) of the action: a small trail blaze after the label. */
  readonly grade?: Grade;
}

/**
 * The Lykia button. `primary` is the one action of a view (glacier game
 * bevel, stepped corners); `signpost` the sun bevel for wayfinding; `ink`
 * the secondary; `solid-ink`, `danger`, `ghost`, `long`, `short`. Sizes
 * xs-xl; md is the 40 px default, lg the 48 px touch size.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, fullWidth, loading = false, leftIcon, rightIcon, grade, className, children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <ContourLoader /> : leftIcon}
      {children}
      {grade ? <Blaze grade={grade} size={14} /> : null}
      {rightIcon}
    </button>
  );
});

export interface ButtonLinkProps extends LinkProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly leftIcon?: React.ReactNode;
  readonly rightIcon?: React.ReactNode;
  readonly grade?: Grade;
}

/** A router link styled as a Button (navigation must stay a link for middle-click and screen readers). */
export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant, size, fullWidth, leftIcon, rightIcon, grade, className, children, ...rest },
  ref,
) {
  return (
    <Link ref={ref} className={buttonClasses({ variant, size, fullWidth, className })} {...rest}>
      {leftIcon}
      {children}
      {grade ? <Blaze grade={grade} size={14} /> : null}
      {rightIcon}
    </Link>
  );
});
