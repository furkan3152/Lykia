/**
 * Renders Lyko's answers from the safe markdown tree (richText.ts) with
 * React elements only: no HTML string ever reaches the DOM. Addresses and
 * transaction hashes are chips with copy and an explorer link; amounts are
 * emphasised figures. The first block can be drawn as the verdict line.
 */
import { explorerAddress, explorerTx, networkFor, shortHash, type ArcEnvironment } from "@lykia/core";
import { Fragment, useState } from "react";

import { Link } from "../../app/routes/Link";
import { Mark } from "../../mosaic/PixelArt";
import { cx } from "../../mosaic/cx";
import { parseInline, parseMarkdown, type Block, type Inline } from "./richText";
import { t } from "../../i18n";


/** An address or transaction hash: shortened, copyable, linked to the explorer. */
export function HashChip({ value, kind, environment }: { readonly value: string; readonly kind: "address" | "tx"; readonly environment: ArcEnvironment }) {
  const [copied, setCopied] = useState(false);
  const network = networkFor(environment);
  const href = kind === "tx" ? explorerTx(network, value) : explorerAddress(network, value);
  const copy = () => {
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      },
      () => undefined,
    );
  };
  return (
    <span className="m-hash" data-kind={kind} data-copied={copied || undefined}>
      <span className="m-hash__k" aria-hidden="true">{kind === "tx" ? "TX" : "0x"}</span>
      <a className="m-hash__v" href={href} target="_blank" rel="noreferrer noopener" title={t("ask.markdown.onTheArcExplorer", { value })}>
        <span aria-hidden="true">{shortHash(value, 4, 4)}</span>
        <span className="sr-only">{t("ask.markdown.openOnTheArcExplorer", { value: kind === "tx" ? t("ask.markdown.transaction") : t("ask.markdown.address"), value2: value })}</span>
        <Mark name="out" size={9} />
      </a>
      <button type="button" className="m-hash__copy" onClick={copy} aria-label={copied ? t("ask.markdown.copied") : t(kind === "tx" ? "ask.markdown.copyTransactionHash" : "ask.markdown.copyAddress")}>
        <Mark name={copied ? "check" : "copy"} size={11} />
      </button>
    </span>
  );
}

/** A USDC / EURC / USD amount as an emphasised figure. */
function Figure({ v, unit }: { readonly v: string; readonly unit: string }) {
  return unit === "$" ? (
    <b className="m-fig">
      <span className="m-fig__cur">$</span>
      {v}
    </b>
  ) : (
    <b className="m-fig">
      {v}
      <small>{unit}</small>
    </b>
  );
}

function Inlines({ nodes, environment }: { readonly nodes: readonly Inline[]; readonly environment: ArcEnvironment }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.t) {
          case "text":
            return <Fragment key={i}>{n.v}</Fragment>;
          case "strong":
            return (
              <strong key={i}>
                <Inlines nodes={n.c} environment={environment} />
              </strong>
            );
          case "em":
            return (
              <em key={i}>
                <Inlines nodes={n.c} environment={environment} />
              </em>
            );
          case "code":
            return (
              <code key={i} className="m-md__code">
                {n.v}
              </code>
            );
          case "link":
            return n.href.startsWith("/") ? (
              <Link key={i} to={n.href} className="m-md__a">
                <Inlines nodes={n.c} environment={environment} />
              </Link>
            ) : (
              <a key={i} href={n.href} className="m-md__a" target="_blank" rel="noreferrer noopener">
                <Inlines nodes={n.c} environment={environment} />
              </a>
            );
          case "address":
          case "tx":
            return <HashChip key={i} value={n.v} kind={n.t} environment={environment} />;
          case "amount":
            return <Figure key={i} v={n.v} unit={n.unit} />;
          default:
            return null;
        }
      })}
    </>
  );
}

function BlockView({ b, environment, lead }: { readonly b: Block; readonly environment: ArcEnvironment; readonly lead: boolean }) {
  switch (b.t) {
    case "p":
      return (
        <p className={cx("m-md__p", lead && "m-md__lead")}>
          <Inlines nodes={b.c} environment={environment} />
        </p>
      );
    case "h":
      return (
        <p className={cx("m-md__h", lead && "m-md__lead")} role="heading" aria-level={Math.min(6, b.level + 2)}>
          <Inlines nodes={b.c} environment={environment} />
        </p>
      );
    case "ul":
      return (
        <ul className="m-md__ul">
          {b.items.map((item, i) => (
            <li key={i}>
              <Inlines nodes={item} environment={environment} />
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="m-md__ol" start={b.start}>
          {b.items.map((item, i) => (
            <li key={i}>
              <Inlines nodes={item} environment={environment} />
            </li>
          ))}
        </ol>
      );
    default:
      return null;
  }
}

/** One line of server text (a plan step, a Fence rule) with the same chips and figures, no block markup. */
export function RichLine({ text, environment }: { readonly text: string; readonly environment: ArcEnvironment }) {
  return <Inlines nodes={parseInline(text)} environment={environment} />;
}

/** Lyko's answer text. `lead` draws the first paragraph as the verdict line. */
/** `figures`: the text was written by code from card data, so its amounts may be emphasised. Model prose never sets it. */
export function Markdown({ text, environment, lead = false, className, figures = false }: { readonly text: string; readonly environment: ArcEnvironment; readonly lead?: boolean; readonly className?: string; readonly figures?: boolean }) {
  const blocks = parseMarkdown(text, { amounts: figures });
  return (
    <div className={cx("m-md", className)}>
      {blocks.map((b, i) => (
        <BlockView key={i} b={b} environment={environment} lead={lead && i === 0 && (b.t === "p" || b.t === "h")} />
      ))}
    </div>
  );
}
