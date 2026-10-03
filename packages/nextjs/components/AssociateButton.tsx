"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useWriteContract } from "wagmi";
import { useTargetNetwork, useTransactor } from "~~/hooks/scaffold-hbar";
import { htsTokenAbi } from "~~/lib/hts";
import { getParsedError } from "~~/utils/scaffold-hbar";

type AssociateButtonProps = {
  token: Address;
  label: string;
  onDone?: () => void | Promise<void>;
  className?: string;
};

/**
 * One-click association through the token's own facade (`associate()`, HIP-719). The HTS system contract
 * cannot associate an account on its behalf from a wallet transaction, so the facade is the way in.
 */
export const AssociateButton = ({ token, label, onDone, className = "" }: AssociateButtonProps) => {
  const { targetNetwork } = useTargetNetwork();
  const { writeContractAsync } = useWriteContract();
  const writeTx = useTransactor();
  const [busy, setBusy] = useState(false);

  const associate = async () => {
    setBusy(true);
    try {
      await writeTx(() =>
        writeContractAsync({ address: token, abi: htsTokenAbi, functionName: "associate", chainId: targetNetwork.id }),
      );
      await onDone?.();
    } catch (error) {
      console.error("associate failed:", getParsedError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={`btn btn-sm btn-primary ${className}`} onClick={associate} disabled={busy}>
      {busy ? <span className="loading loading-spinner loading-xs" /> : null}
      Associate {label}
    </button>
  );
};
