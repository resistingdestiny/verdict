"use client";

import { useState } from "react";
import type { Address } from "viem";
import { useWriteContract } from "wagmi";
import { useTargetNetwork, useTransactor } from "~~/hooks/scaffold-hbar";
import { GAS } from "~~/lib/gas";
import { htsTokenAbi } from "~~/lib/hts";
import { getParsedError } from "~~/utils/scaffold-hbar";

type ApproveButtonProps = {
  token: Address;
  spender: Address;
  amount: bigint;
  label: string;
  onDone?: () => void | Promise<void>;
  className?: string;
};

/** Grants `spender` an allowance of `amount` on an HTS token through its ERC-20 facade. */
export const ApproveButton = ({ token, spender, amount, label, onDone, className = "" }: ApproveButtonProps) => {
  const { targetNetwork } = useTargetNetwork();
  const { writeContractAsync } = useWriteContract();
  const writeTx = useTransactor();
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    setBusy(true);
    try {
      await writeTx(() =>
        writeContractAsync({
          address: token,
          abi: htsTokenAbi,
          functionName: "approve",
          args: [spender, amount],
          chainId: targetNetwork.id,
          gas: GAS.approve,
        }),
      );
      await onDone?.();
    } catch (error) {
      console.error("approve failed:", getParsedError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className={`btn btn-sm btn-primary ${className}`} onClick={approve} disabled={busy}>
      {busy ? <span className="loading loading-spinner loading-xs" /> : null}
      Approve {label}
    </button>
  );
};
