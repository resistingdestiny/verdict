"use client";

import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { getParsedError } from "~~/utils/scaffold-hbar";

type RetryStateProps = {
  title?: string;
  error: unknown;
  onRetry: () => void;
};

/** Shown when the RPC or the mirror node failed. The error is decoded, never a raw revert, and a retry is offered. */
export const RetryState = ({ title = "Could not load", error, onRetry }: RetryStateProps) => (
  <div className="rounded-box border border-base-300 bg-base-100 px-6 py-8 text-center">
    <p className="m-0 font-semibold">{title}</p>
    <p className="mt-2 mb-4 text-sm text-base-content/70 whitespace-pre-line break-words">{getParsedError(error)}</p>
    <button type="button" className="btn btn-sm btn-primary" onClick={onRetry}>
      <ArrowPathIcon className="h-4 w-4" />
      Retry
    </button>
  </div>
);
