import { PHASE_LABELS, type Phase } from "~~/lib/verdict";

type StatusBadgeProps = {
  phase: Phase;
  className?: string;
};

const PHASE_CLASSES: Record<Phase, string> = {
  open: "badge-primary",
  awaiting: "badge-outline",
  settled: "badge-neutral",
  void: "badge-ghost",
};

/** Open, awaiting resolution, settled or void. */
export const StatusBadge = ({ phase, className = "" }: StatusBadgeProps) => (
  <span className={`badge badge-sm font-medium ${PHASE_CLASSES[phase]} ${className}`}>{PHASE_LABELS[phase]}</span>
);
