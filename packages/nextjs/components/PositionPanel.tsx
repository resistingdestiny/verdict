"use client";

import { useState } from "react";
import { AmountInput } from "./AmountInput";
import { ApproveButton } from "./ApproveButton";
import { AssociateButton } from "./AssociateButton";
import { TxList } from "./TxList";
import type { Hash } from "viem";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { useTokenState } from "~~/hooks/verdict";
import {
  PAYOUT_SCALE,
  isValidFixed,
  parseFixed,
  payoutToHbar,
  tinybarsToHbar,
  tinybarsToWeibars,
  tokenUnitsToWhole,
} from "~~/lib/format";
import { type MarketView, marketPhase, nowSeconds } from "~~/lib/verdict";
import { getParsedError } from "~~/utils/scaffold-hbar";

type Action = "split" | "merge" | "redeem";

type PositionPanelProps = {
  market: MarketView;
  onChanged: () => void | Promise<void>;
  /** Start on this tab. Defaults to split while open and redeem once settled. */
  initial?: Action;
};

const parseAmount = (text: string): bigint | undefined =>
  text.trim() !== "" && isValidFixed(text, 8) ? parseFixed(text, 8) : undefined;

/**
 * Split HBAR into YES and NO, merge pairs back into HBAR, or redeem after settlement.
 * Split needs the wallet associated with both tokens; merge and redeem need the Verdict contract to hold an
 * allowance on whatever is handed back.
 */
export const PositionPanel = ({ market, onChanged, initial }: PositionPanelProps) => {
  const { address: account } = useAccount();
  const { data: verdict } = useDeployedContractInfo({ contractName: "Verdict" });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "Verdict" });
  const phase = marketPhase(market, nowSeconds());
  const settled = phase === "settled" || phase === "void";
  const [action, setAction] = useState<Action>(initial ?? (settled ? "redeem" : "split"));
  const [amountText, setAmountText] = useState("");
  const [yesText, setYesText] = useState("");
  const [noText, setNoText] = useState("");
  const [hashes, setHashes] = useState<Hash[]>([]);

  const yesState = useTokenState({ token: market.yes, owner: account, spender: verdict?.address });
  const noState = useTokenState({ token: market.no, owner: account, spender: verdict?.address });

  const amount = parseAmount(amountText);
  const yesAmount = parseAmount(yesText) ?? 0n;
  const noAmount = parseAmount(noText) ?? 0n;

  const tabs: { key: Action; label: string; show: boolean }[] = [
    { key: "split", label: "Split", show: phase === "open" },
    { key: "merge", label: "Merge", show: true },
    { key: "redeem", label: "Redeem", show: settled },
  ];
  const visible = tabs.filter(tab => tab.show);
  const effective = visible.some(tab => tab.key === action) ? action : visible[0].key;

  const record = async (hash: Hash | undefined) => {
    if (hash) setHashes(previous => [...previous, hash]);
    setAmountText("");
    setYesText("");
    setNoText("");
    await Promise.all([yesState.refetch(), noState.refetch()]);
    await onChanged();
  };

  const run = async (send: () => Promise<Hash | undefined>) => {
    try {
      await record(await send());
    } catch (error) {
      console.error(`${effective} failed:`, getParsedError(error));
    }
  };

  const split = () =>
    run(() =>
      writeContractAsync({
        functionName: "split",
        args: [market.id, account as string, account as string],
        value: tinybarsToWeibars(amount as bigint),
      }),
    );
  const merge = () =>
    run(() => writeContractAsync({ functionName: "merge", args: [market.id, amount as bigint, account as string] }));
  const redeem = () =>
    run(() =>
      writeContractAsync({ functionName: "redeem", args: [market.id, yesAmount, noAmount, account as string] }),
    );

  const payoutYes = market.payout;
  const payoutNo = PAYOUT_SCALE - market.payout;
  const redeemValue = (yesAmount * payoutYes + noAmount * payoutNo) / PAYOUT_SCALE;

  const needsYesAssociation = yesState.associated === false;
  const needsNoAssociation = noState.associated === false;
  const mergeNeedsYesAllowance = amount !== undefined && (yesState.allowance ?? 0n) < amount;
  const mergeNeedsNoAllowance = amount !== undefined && (noState.allowance ?? 0n) < amount;
  const redeemNeedsYesAllowance = yesAmount > 0n && (yesState.allowance ?? 0n) < yesAmount;
  const redeemNeedsNoAllowance = noAmount > 0n && (noState.allowance ?? 0n) < noAmount;
  const mergeInsufficient =
    amount !== undefined && ((yesState.balance ?? 0n) < amount || (noState.balance ?? 0n) < amount);
  const redeemInsufficient = (yesState.balance ?? 0n) < yesAmount || (noState.balance ?? 0n) < noAmount;

  const connected = Boolean(account) && Boolean(verdict);

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5">
      <h2 className="m-0 text-lg font-semibold">Your position</h2>
      {account ? (
        <p className="mt-1 mb-0 text-sm text-base-content/70">
          You hold {tokenUnitsToWhole(yesState.balance ?? 0n, 4)} YES and {tokenUnitsToWhole(noState.balance ?? 0n, 4)}{" "}
          NO.
        </p>
      ) : (
        <p className="mt-1 mb-0 text-sm text-base-content/70">Connect a wallet to split, merge or redeem.</p>
      )}
      <div role="tablist" className="tabs tabs-box mt-3 tabs-sm">
        {visible.map(tab => (
          <button
            key={tab.key}
            role="tab"
            type="button"
            className={`tab ${effective === tab.key ? "tab-active" : ""}`}
            onClick={() => setAction(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {effective === "split" ? (
        <div className="mt-3">
          <p className="m-0 mb-2 text-sm text-base-content/70">
            Pay HBAR to receive the same amount of YES and NO. One YES plus one NO is always worth 1 HBAR.
          </p>
          <AmountInput
            value={amountText}
            onChange={setAmountText}
            unit="HBAR"
            invalid={amountText !== "" && amount === undefined}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {connected && needsYesAssociation ? (
              <AssociateButton token={market.yes} label="YES" onDone={yesState.refetch} />
            ) : null}
            {connected && needsNoAssociation ? (
              <AssociateButton token={market.no} label="NO" onDone={noState.refetch} />
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm ml-auto"
              disabled={
                !connected ||
                amount === undefined ||
                amount === 0n ||
                needsYesAssociation ||
                needsNoAssociation ||
                isMining
              }
              onClick={split}
            >
              {isMining ? <span className="loading loading-spinner loading-xs" /> : null}
              Split {amount !== undefined ? `${tinybarsToHbar(amount, 4)} HBAR` : ""}
            </button>
          </div>
        </div>
      ) : null}

      {effective === "merge" ? (
        <div className="mt-3">
          <p className="m-0 mb-2 text-sm text-base-content/70">
            Hand back one YES and one NO per HBAR you want returned.
          </p>
          <AmountInput
            value={amountText}
            onChange={setAmountText}
            unit="pairs"
            invalid={amountText !== "" && amount === undefined}
            max={
              yesState.balance !== undefined && noState.balance !== undefined
                ? tokenUnitsToWhole(yesState.balance < noState.balance ? yesState.balance : noState.balance)
                : undefined
            }
          />
          {mergeInsufficient ? (
            <p className="mt-2 mb-0 text-sm text-error">You need that many of both YES and NO.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {connected && verdict && amount !== undefined && mergeNeedsYesAllowance ? (
              <ApproveButton
                token={market.yes}
                spender={verdict.address}
                amount={amount}
                label="YES for Verdict"
                onDone={yesState.refetch}
              />
            ) : null}
            {connected && verdict && amount !== undefined && mergeNeedsNoAllowance ? (
              <ApproveButton
                token={market.no}
                spender={verdict.address}
                amount={amount}
                label="NO for Verdict"
                onDone={noState.refetch}
              />
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm ml-auto"
              disabled={
                !connected ||
                amount === undefined ||
                amount === 0n ||
                mergeNeedsYesAllowance ||
                mergeNeedsNoAllowance ||
                mergeInsufficient ||
                isMining
              }
              onClick={merge}
            >
              {isMining ? <span className="loading loading-spinner loading-xs" /> : null}
              Merge {amount !== undefined ? `for ${tinybarsToHbar(amount, 4)} HBAR` : ""}
            </button>
          </div>
        </div>
      ) : null}

      {effective === "redeem" ? (
        <div className="mt-3">
          <p className="m-0 mb-2 text-sm text-base-content/70">
            YES pays {payoutToHbar(payoutYes)} HBAR and NO pays {payoutToHbar(payoutNo)} HBAR per token. Burn any amount
            of either.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <AmountInput
              value={yesText}
              onChange={setYesText}
              unit="YES"
              invalid={yesText !== "" && parseAmount(yesText) === undefined}
              max={yesState.balance !== undefined ? tokenUnitsToWhole(yesState.balance) : undefined}
            />
            <AmountInput
              value={noText}
              onChange={setNoText}
              unit="NO"
              invalid={noText !== "" && parseAmount(noText) === undefined}
              max={noState.balance !== undefined ? tokenUnitsToWhole(noState.balance) : undefined}
            />
          </div>
          <p className="mt-2 mb-0 text-sm">You receive {tinybarsToHbar(redeemValue, 4)} HBAR.</p>
          {redeemInsufficient ? <p className="mt-1 mb-0 text-sm text-error">More than this wallet holds.</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {connected && verdict && redeemNeedsYesAllowance ? (
              <ApproveButton
                token={market.yes}
                spender={verdict.address}
                amount={yesAmount}
                label="YES for Verdict"
                onDone={yesState.refetch}
              />
            ) : null}
            {connected && verdict && redeemNeedsNoAllowance ? (
              <ApproveButton
                token={market.no}
                spender={verdict.address}
                amount={noAmount}
                label="NO for Verdict"
                onDone={noState.refetch}
              />
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm ml-auto"
              disabled={
                !connected ||
                yesAmount + noAmount === 0n ||
                redeemNeedsYesAllowance ||
                redeemNeedsNoAllowance ||
                redeemInsufficient ||
                isMining
              }
              onClick={redeem}
            >
              {isMining ? <span className="loading loading-spinner loading-xs" /> : null}
              Redeem
            </button>
          </div>
        </div>
      ) : null}
      <div className="mt-3">
        <TxList hashes={hashes} />
      </div>
    </section>
  );
};
