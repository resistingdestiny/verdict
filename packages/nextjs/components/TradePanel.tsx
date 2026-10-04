"use client";

import { useState } from "react";
import { AmountInput } from "./AmountInput";
import { ApproveButton } from "./ApproveButton";
import { AssociateButton } from "./AssociateButton";
import { TxList } from "./TxList";
import type { Hash } from "viem";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-hbar";
import { useTokenState } from "~~/hooks/verdict";
import {
  applySlippage,
  deadlineFromNow,
  isValidFixed,
  parseFixed,
  tinybarsToHbar,
  tinybarsToWeibars,
  tokenUnitsToWhole,
} from "~~/lib/format";
import { GAS } from "~~/lib/gas";
import { type MarketView, marketPhase, nowSeconds } from "~~/lib/verdict";
import { getParsedError } from "~~/utils/scaffold-hbar";

type Trade = "buyYes" | "sellYes" | "buyNo" | "sellNo";

const TRADES: { key: Trade; label: string; unit: "HBAR" | "YES" | "NO"; summary: string }[] = [
  { key: "buyYes", label: "Buy YES", unit: "HBAR", summary: "Swaps your HBAR for YES in the pool." },
  { key: "sellYes", label: "Sell YES", unit: "YES", summary: "Swaps your YES for HBAR in the pool." },
  {
    key: "buyNo",
    label: "Buy NO",
    unit: "HBAR",
    summary:
      "Splits all of your HBAR into YES and NO, then sells the YES leg in the pool. You keep the NO and the sale proceeds.",
  },
  {
    key: "sellNo",
    label: "Sell NO",
    unit: "NO",
    summary:
      "Buys the matching YES in the pool with HBAR you send along, merges the pairs and pays you the merged HBAR plus whatever was not spent. The quote is your net: the NO's worth less the YES cost.",
  },
];

const DEFAULT_SLIPPAGE_PERCENT = "1";
const DEADLINE_MINUTES = 10;

type TradePanelProps = {
  market: MarketView;
  hasPool: boolean;
  onTraded: () => void | Promise<void>;
};

/**
 * The four router trades with live quotes. Slippage defaults to 1 percent and the deadline to now plus
 * ten minutes. Before a trade that delivers a token the wallet is checked for association; before one that
 * pulls a token the router's allowance is checked, and the missing step is offered as a button.
 */
export const TradePanel = ({ market, hasPool, onTraded }: TradePanelProps) => {
  const { address: account } = useAccount();
  const { data: router } = useDeployedContractInfo({ contractName: "VerdictRouter" });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({ contractName: "VerdictRouter" });
  const [trade, setTrade] = useState<Trade>("buyYes");
  const [amountText, setAmountText] = useState("");
  const [slippageText, setSlippageText] = useState(DEFAULT_SLIPPAGE_PERCENT);
  const [hashes, setHashes] = useState<Hash[]>([]);

  const amountValid = amountText.trim() !== "" && isValidFixed(amountText, 8) && parseFixed(amountText, 8) > 0n;
  const amount = amountValid ? parseFixed(amountText, 8) : undefined;
  const slippageNumber = Number(slippageText);
  const slippageValid = Number.isFinite(slippageNumber) && slippageNumber >= 0 && slippageNumber <= 50;
  const bps = slippageValid ? Math.round(slippageNumber * 100) : 100;

  const buyYesQuote = useScaffoldReadContract({
    contractName: "VerdictRouter",
    functionName: "quoteBuyYes",
    args: [market.id, trade === "buyYes" ? amount : undefined],
  });
  const sellYesQuote = useScaffoldReadContract({
    contractName: "VerdictRouter",
    functionName: "quoteSellYes",
    args: [market.id, trade === "sellYes" ? amount : undefined],
  });
  const buyNoQuote = useScaffoldReadContract({
    contractName: "VerdictRouter",
    functionName: "quoteBuyNo",
    args: [market.id, trade === "buyNo" ? amount : undefined],
  });
  const sellNoQuote = useScaffoldReadContract({
    contractName: "VerdictRouter",
    functionName: "quoteSellNo",
    args: [market.id, trade === "sellNo" ? amount : undefined],
  });
  const quotes = { buyYes: buyYesQuote, sellYes: sellYesQuote, buyNo: buyNoQuote, sellNo: sellNoQuote };
  const active = quotes[trade];

  const yesState = useTokenState({ token: market.yes, owner: account, spender: router?.address });
  const noState = useTokenState({ token: market.no, owner: account, spender: router?.address });

  const phase = marketPhase(market, nowSeconds());
  const current = TRADES.find(entry => entry.key === trade) as (typeof TRADES)[number];
  const deliverState = trade === "buyYes" ? yesState : trade === "buyNo" ? noState : undefined;
  const pullState = trade === "sellYes" ? yesState : trade === "sellNo" ? noState : undefined;
  const needsAssociation = deliverState?.associated === false;
  const needsAllowance = pullState !== undefined && amount !== undefined && (pullState.allowance ?? 0n) < amount;
  const insufficient = pullState !== undefined && amount !== undefined && (pullState.balance ?? 0n) < amount;

  const buyYesOut = buyYesQuote.data as bigint | undefined;
  const sellYesOut = sellYesQuote.data as bigint | undefined;
  const buyNoOut = buyNoQuote.data as readonly [bigint, bigint] | undefined;
  const sellNoOut = sellNoQuote.data as readonly [bigint, bigint] | undefined;

  const submit = async () => {
    if (amount === undefined || !account) return;
    const deadline = deadlineFromNow(DEADLINE_MINUTES);
    try {
      let hash: Hash | undefined;
      if (trade === "buyYes" && buyYesOut !== undefined) {
        hash = await writeContractAsync({
          functionName: "buyYes",
          args: [market.id, applySlippage(buyYesOut, bps, "down"), deadline],
          value: tinybarsToWeibars(amount),
          gas: GAS.buyYes,
        });
      } else if (trade === "sellYes" && sellYesOut !== undefined) {
        hash = await writeContractAsync({
          functionName: "sellYes",
          args: [market.id, amount, applySlippage(sellYesOut, bps, "down"), deadline],
          gas: GAS.sellYes,
        });
      } else if (trade === "buyNo" && buyNoOut !== undefined) {
        hash = await writeContractAsync({
          functionName: "buyNo",
          args: [market.id, applySlippage(buyNoOut[1], bps, "down"), deadline],
          value: tinybarsToWeibars(amount),
          gas: GAS.buyNo,
        });
      } else if (trade === "sellNo" && sellNoOut !== undefined) {
        hash = await writeContractAsync({
          functionName: "sellNo",
          args: [market.id, amount, applySlippage(sellNoOut[1], bps, "down"), deadline],
          value: tinybarsToWeibars(applySlippage(sellNoOut[0], bps, "up")),
          gas: GAS.sellNo,
        });
      }
      if (hash) setHashes(previous => [...previous, hash]);
      setAmountText("");
      await Promise.all([yesState.refetch(), noState.refetch()]);
      await onTraded();
    } catch (error) {
      console.error("trade failed:", getParsedError(error));
    }
  };

  const quoteLines = (): string[] => {
    if (amount === undefined) return [];
    switch (trade) {
      case "buyYes":
        return buyYesOut === undefined
          ? []
          : [
              `You receive about ${tokenUnitsToWhole(buyYesOut, 4)} YES.`,
              `At least ${tokenUnitsToWhole(applySlippage(buyYesOut, bps, "down"), 4)} YES after slippage.`,
            ];
      case "sellYes":
        return sellYesOut === undefined
          ? []
          : [
              `You receive about ${tinybarsToHbar(sellYesOut, 4)} HBAR.`,
              `At least ${tinybarsToHbar(applySlippage(sellYesOut, bps, "down"), 4)} HBAR after slippage.`,
            ];
      case "buyNo":
        return buyNoOut === undefined
          ? []
          : [
              `You receive ${tokenUnitsToWhole(buyNoOut[0], 4)} NO and about ${tinybarsToHbar(buyNoOut[1], 4)} HBAR back.`,
              `Net cost about ${tinybarsToHbar(amount - buyNoOut[1], 4)} HBAR.`,
            ];
      case "sellNo":
        return sellNoOut === undefined
          ? []
          : [
              `Send ${tinybarsToHbar(applySlippage(sellNoOut[0], bps, "up"), 4)} HBAR along to buy the matching YES; what is not spent comes back.`,
              `You receive about ${tinybarsToHbar(sellNoOut[1], 4)} HBAR net of the YES purchase, at least ${tinybarsToHbar(applySlippage(sellNoOut[1], bps, "down"), 4)} after slippage.`,
            ];
    }
  };

  const blocked = !hasPool
    ? "No pool yet. Trades go through the market's SaucerSwap pool; seed one from the Create page."
    : phase !== "open"
      ? "Trading is closed. The market has expired; merge and redeem stay available below."
      : !router
        ? "The router is not deployed on this network."
        : null;

  const canSubmit =
    blocked === null &&
    Boolean(account) &&
    amount !== undefined &&
    slippageValid &&
    active.data !== undefined &&
    !active.isError &&
    !needsAssociation &&
    !needsAllowance &&
    !insufficient &&
    !isMining;

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-5">
      <h2 className="m-0 text-lg font-semibold">Trade</h2>
      <div role="tablist" className="tabs tabs-box mt-3 tabs-sm">
        {TRADES.map(entry => (
          <button
            key={entry.key}
            role="tab"
            type="button"
            className={`tab ${trade === entry.key ? "tab-active" : ""}`}
            onClick={() => {
              setTrade(entry.key);
              setAmountText("");
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className="mt-3 mb-2 text-sm text-base-content/70">{current.summary}</p>

      {blocked ? <p className="m-0 mb-3 rounded-field bg-base-200 px-3 py-2 text-sm">{blocked}</p> : null}

      <label className="label text-xs" htmlFor="trade-amount">
        Amount in {current.unit}
        {pullState?.balance !== undefined ? (
          <span className="ml-auto">Balance {tokenUnitsToWhole(pullState.balance, 4)}</span>
        ) : null}
      </label>
      <AmountInput
        id="trade-amount"
        value={amountText}
        onChange={setAmountText}
        unit={current.unit}
        max={pullState?.balance !== undefined ? tokenUnitsToWhole(pullState.balance) : undefined}
        invalid={amountText.trim() !== "" && !amountValid}
        disabled={blocked !== null}
      />

      <div className="mt-3 flex items-center gap-2 text-xs">
        <label htmlFor="trade-slippage">Max slippage</label>
        <input
          id="trade-slippage"
          type="text"
          inputMode="decimal"
          className={`input input-bordered input-xs w-16 ${slippageValid ? "" : "input-error"}`}
          value={slippageText}
          onChange={event => setSlippageText(event.target.value)}
        />
        <span>%</span>
        <span className="ml-auto text-base-content/60">Deadline: now + {DEADLINE_MINUTES} minutes</span>
      </div>

      <div className="mt-3 min-h-10 text-sm">
        {active.isError && amount !== undefined ? (
          <p className="m-0 text-error whitespace-pre-line">{getParsedError(active.error)}</p>
        ) : amount !== undefined && active.data === undefined && blocked === null ? (
          <span className="loading loading-dots loading-xs" />
        ) : (
          quoteLines().map(line => (
            <p key={line} className="m-0">
              {line}
            </p>
          ))
        )}
        {insufficient ? <p className="m-0 text-error">Not enough {current.unit} in this wallet.</p> : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!account ? <p className="m-0 text-sm text-base-content/70">Connect a wallet to trade.</p> : null}
        {account && deliverState && needsAssociation && router ? (
          <AssociateButton
            token={trade === "buyYes" ? market.yes : market.no}
            label={trade === "buyYes" ? "YES" : "NO"}
            onDone={deliverState.refetch}
          />
        ) : null}
        {account && deliverState?.associationUnknown ? (
          <p className="m-0 text-xs text-base-content/60">
            Could not confirm association with the mirror node. If the trade reverts with NotAssociated, associate
            first.
          </p>
        ) : null}
        {account && pullState && needsAllowance && router && amount !== undefined ? (
          <ApproveButton
            token={trade === "sellYes" ? market.yes : market.no}
            spender={router.address}
            amount={amount}
            label={`${tokenUnitsToWhole(amount, 4)} ${current.unit} for the router`}
            onDone={pullState.refetch}
          />
        ) : null}
        <button type="button" className="btn btn-primary btn-sm ml-auto" disabled={!canSubmit} onClick={submit}>
          {isMining ? <span className="loading loading-spinner loading-xs" /> : null}
          {current.label}
        </button>
      </div>
      <div className="mt-3">
        <TxList hashes={hashes} />
      </div>
    </section>
  );
};
