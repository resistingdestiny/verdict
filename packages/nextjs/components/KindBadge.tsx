import { KIND_DESCRIPTIONS, KIND_LABELS, type Kind } from "~~/lib/payoff";

type KindBadgeProps = {
  kind: Kind;
  className?: string;
};

/** The market kind as a small outlined badge. The payoff rule is in the tooltip. */
export const KindBadge = ({ kind, className = "" }: KindBadgeProps) => (
  <span className={`badge badge-outline badge-sm font-medium ${className}`} title={KIND_DESCRIPTIONS[kind]}>
    {KIND_LABELS[kind]}
  </span>
);
