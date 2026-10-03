import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
};

/** A quiet box for lists and panels with nothing to show yet. */
export const EmptyState = ({ title, body, action }: EmptyStateProps) => (
  <div className="rounded-box border border-dashed border-base-300 bg-base-100 px-6 py-10 text-center">
    <p className="m-0 font-semibold">{title}</p>
    {body ? <div className="mt-2 text-sm text-base-content/70">{body}</div> : null}
    {action ? <div className="mt-4">{action}</div> : null}
  </div>
);
