type LoadingStateProps = {
  label?: string;
};

/** A spinner with a label, used wherever a chain or mirror node read is in flight. */
export const LoadingState = ({ label = "Loading" }: LoadingStateProps) => (
  <div className="flex items-center justify-center gap-3 rounded-box bg-base-100 border border-base-300 px-6 py-10">
    <span className="loading loading-spinner loading-sm" aria-hidden />
    <span className="text-sm text-base-content/70">{label}</span>
  </div>
);
