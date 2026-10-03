"use client";

import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useTargetNetwork } from "~~/hooks/scaffold-hbar";
import { shortHex } from "~~/lib/format";
import { type HashScanKind, hashscanUrl, longZeroToEntityId, networkName } from "~~/lib/hts";

type HashScanLinkProps = {
  kind: HashScanKind;
  value: string;
  label?: string;
  className?: string;
};

/** A link to HashScan for a token, schedule, contract, account, topic or transaction on the target network. */
export const HashScanLink = ({ kind, value, label, className = "" }: HashScanLinkProps) => {
  const { targetNetwork } = useTargetNetwork();
  const text = label ?? longZeroToEntityId(value) ?? shortHex(value);
  return (
    <a
      href={hashscanUrl(networkName(targetNetwork.id), kind, value)}
      target="_blank"
      rel="noreferrer"
      className={`link inline-flex items-center gap-1 break-all ${className}`}
      title={value}
    >
      {text}
      <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
    </a>
  );
};
