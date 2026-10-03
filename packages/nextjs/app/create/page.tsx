"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { NextPage } from "next";
import { type Hash, type Hex, parseEventLogs } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { AmountInput } from "~~/components/AmountInput";
import { ApproveButton } from "~~/components/ApproveButton";
import { AssociateButton } from "~~/components/AssociateButton";
import { EmptyState } from "~~/components/EmptyState";
import { HashScanLink } from "~~/components/HashScanLink";
import { LoadingState } from "~~/components/LoadingState";
import { PayoffDiagram } from "~~/components/PayoffDiagram";
import { TxList } from "~~/components/TxList";
import externalContracts from "~~/contracts/externalContracts";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTargetNetwork,
} from "~~/hooks/scaffold-hbar";
import { useFeeds, useLivePrice, useTokenState, useVerdictMarket } from "~~/hooks/verdict";
import {
  applySlippage,
  deadlineFromNow,
  feedAnswerToPrice,
  formatUtc,
  isValidFixed,
  localInputToUnix,
  parseFixed,
  priceToFeedAnswer,
  tinybarsToHbar,
  tinybarsToWeibars,
  tokenUnitsToWhole,
  unixToLocalInput,
} from "~~/lib/format";
import { KINDS, KIND_DESCRIPTIONS, KIND_LABELS, Kind, boundsValid, kindUsesUpper, questionText } from "~~/lib/payoff";
import { nowSeconds } from "~~/lib/verdict";
import { getParsedError } from "~~/utils/scaffold-hbar";

const DEFAULT_MIN_LEAD = 300;
const DEFAULT_MAX_LEAD = 62 * 86_400;
const FEE_CUSHION_BPS = 100;
const DEADLINE_MINUTES = 10;

const parseAmount = (text: string): bigint | undefined =>
  text.trim() !== "" && isValidFixed(text, 8) && parseFixed(text, 8) > 0n ? parseFixed(text, 8) : undefined;

const toUnix = (value: string): number | undefined => {
  try {
    return localInputToUnix(value);
  } catch {
    return undefined;
  }
};

const Step = ({
  number,
  title,
  done,
  children,
}: {
  number: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}) => (
  <section className="rounded-box border border-base-300 bg-base-100 p-5">
    <h2 className="m-0 flex items-center gap-2 text-lg font-semibold">
      <span className={`badge badge-sm ${done ? "badge-primary" : "badge-outline"}`}>{done ? "done" : number}</span>
      {title}
    </h2>
    <div className="mt-3">{children}</div>
  </section>
);

/**
 * Create, split, approve and seed. The creator's own wallet creates and seeds the SaucerSwap pool, so the
 * page walks through the four transactions in order and resumes from a market id after a reload.
 */
const CreateFlow = () => {
  const { address: account } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const searchParams = useSearchParams();
  const seedParam = searchParams.get("seed");

  const { feeds, resolverAddress, resolverDeployed, isLoading: feedsLoading } = useFeeds();
  const allowedFeeds = feeds.filter(feed => feed.allowed);
  const [feedId, setFeedId] = useState<Hex | undefined>();
  const selected = feeds.find(feed => feed.feedId === feedId) ?? allowedFeeds[0] ?? feeds[0];
  const live = useLivePrice(selected?.aggregator);
  const decimals = selected?.decimals ?? 8;

  const [kind, setKind] = useState<Kind>(Kind.Above);
  const [lowerText, setLowerText] = useState("");
  const [upperText, setUpperText] = useState("");
  const [expiryLocal, setExpiryLocal] = useState(() => unixToLocalInput(nowSeconds() + 3_600));
  const [splitText, setSplitText] = useState("20");
  const [yesLiquidityText, setYesLiquidityText] = useState("20");
  const [hbarLiquidityText, setHbarLiquidityText] = useState("10");
  const [marketIdText, setMarketIdText] = useState(seedParam ?? "");
  const [hashes, setHashes] = useState<Hash[]>([]);

  useEffect(() => {
    if (seedParam) setMarketIdText(seedParam);
  }, [seedParam]);

  const { data: verdict, isLoading: verdictLoading } = useDeployedContractInfo({ contractName: "Verdict" });
  const { data: saucerRouter } = useDeployedContractInfo({ contractName: "SaucerSwapRouter" });
  const creationCost = useScaffoldReadContract({ contractName: "Verdict", functionName: "creationCost" });
  const minLead = useScaffoldReadContract({ contractName: "Verdict", functionName: "MIN_LEAD", watch: false });
  const maxLead = useScaffoldReadContract({ contractName: "Verdict", functionName: "MAX_LEAD", watch: false });
  const resolverAllowed = useScaffoldReadContract({
    contractName: "Verdict",
    functionName: "resolverAllowed",
    args: [resolverAddress],
    watch: false,
  });
  const pairFee = useScaffoldReadContract({
    contractName: "SaucerSwapFactory",
    functionName: "pairCreateFee",
    watch: false,
  });
  // The exchange rate system contract is read without the deployed-code check, which does not apply to a system contract.
  const exchangeRate = externalContracts[296].ExchangeRate;
  const feeTinybars = useReadContract({
    address: exchangeRate.address,
    abi: exchangeRate.abi,
    functionName: "tinycentsToTinybars",
    args: [pairFee.data ?? 0n],
    chainId: targetNetwork.id,
    query: { enabled: pairFee.data !== undefined, refetchInterval: 60_000 },
  });

  const verdictWrite = useScaffoldWriteContract({ contractName: "Verdict" });
  const saucerWrite = useScaffoldWriteContract({ contractName: "SaucerSwapRouter" });

  const marketId = /^\d+$/.test(marketIdText) ? BigInt(marketIdText) : undefined;
  const created = useVerdictMarket(marketId);
  const yesState = useTokenState({ token: created.market?.yes, owner: account, spender: saucerRouter?.address });
  const noState = useTokenState({ token: created.market?.no, owner: account });

  const now = nowSeconds();
  const lower =
    lowerText.trim() !== "" && isValidFixed(lowerText, decimals) ? priceToFeedAnswer(lowerText, decimals) : undefined;
  const upper = kindUsesUpper(kind)
    ? upperText.trim() !== "" && isValidFixed(upperText, decimals)
      ? priceToFeedAnswer(upperText, decimals)
      : undefined
    : 0n;
  const boundsOk = lower !== undefined && upper !== undefined && boundsValid(kind, lower, upper);
  const expiry = toUnix(expiryLocal);
  const earliest = now + Number(minLead.data ?? BigInt(DEFAULT_MIN_LEAD));
  const latest = now + Number(maxLead.data ?? BigInt(DEFAULT_MAX_LEAD));
  const expiryOk = expiry !== undefined && expiry >= earliest && expiry <= latest;
  const splitAmount = parseAmount(splitText);
  const yesLiquidity = parseAmount(yesLiquidityText);
  const hbarLiquidity = parseAmount(hbarLiquidityText);

  const canCreate =
    Boolean(account && verdict && selected?.allowed && resolverAddress) &&
    resolverAllowed.data === true &&
    boundsOk &&
    expiryOk &&
    creationCost.data !== undefined &&
    !verdictWrite.isMining;

  const create = async () => {
    if (!selected || !resolverAddress || !verdict || lower === undefined || upper === undefined || expiry === undefined)
      return;
    if (creationCost.data === undefined) return;
    try {
      const hash = await verdictWrite.writeContractAsync(
        {
          functionName: "createMarket",
          args: [resolverAddress, selected.feedId, kind, lower, upper, BigInt(expiry)],
          value: tinybarsToWeibars(creationCost.data),
        },
        {
          onBlockConfirmation: receipt => {
            const logs = parseEventLogs({ abi: verdict.abi, eventName: "MarketCreated", logs: receipt.logs });
            if (logs.length > 0) setMarketIdText(logs[0].args.id.toString());
          },
        },
      );
      if (hash) setHashes(previous => [...previous, hash]);
    } catch (error) {
      console.error("createMarket failed:", getParsedError(error));
    }
  };

  const split = async () => {
    if (marketId === undefined || !account || splitAmount === undefined) return;
    try {
      const hash = await verdictWrite.writeContractAsync({
        functionName: "split",
        args: [marketId, account, account],
        value: tinybarsToWeibars(splitAmount),
      });
      if (hash) setHashes(previous => [...previous, hash]);
      await Promise.all([yesState.refetch(), noState.refetch()]);
    } catch (error) {
      console.error("split failed:", getParsedError(error));
    }
  };

  const seed = async () => {
    const market = created.market;
    if (!market || !account || yesLiquidity === undefined || hbarLiquidity === undefined) return;
    const deadline = deadlineFromNow(DEADLINE_MINUTES);
    const minHbar = applySlippage(hbarLiquidity, FEE_CUSHION_BPS, "down");
    try {
      let hash: Hash | undefined;
      if (created.hasPool) {
        hash = await saucerWrite.writeContractAsync({
          functionName: "addLiquidityETH",
          args: [market.yes, yesLiquidity, yesLiquidity, minHbar, account, deadline],
          value: tinybarsToWeibars(hbarLiquidity),
        });
      } else {
        if (feeTinybars.data === undefined) return;
        const fee = applySlippage(feeTinybars.data, FEE_CUSHION_BPS, "up");
        hash = await saucerWrite.writeContractAsync({
          functionName: "addLiquidityETHNewPool",
          args: [market.yes, yesLiquidity, yesLiquidity, minHbar, account, deadline],
          value: tinybarsToWeibars(hbarLiquidity + fee),
        });
      }
      if (hash) setHashes(previous => [...previous, hash]);
      await Promise.all([yesState.refetch(), created.refetch()]);
    } catch (error) {
      console.error("seed failed:", getParsedError(error));
    }
  };

  const step1Done = marketId !== undefined && created.status === "ready";
  const step2Done = step1Done && yesLiquidity !== undefined && (yesState.balance ?? 0n) >= yesLiquidity;
  const step3Done = step2Done && (yesState.allowance ?? 0n) >= (yesLiquidity ?? 0n);
  const step4Done = step1Done && created.hasPool;

  if (!verdict && !verdictLoading) {
    return (
      <EmptyState
        title="Verdict is not deployed on this network"
        body="Deploy the contracts and the Create page comes alive."
      />
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-5">
      <div className="flex flex-col gap-5 lg:col-span-3">
        <Step number={1} title="Create the market" done={step1Done}>
          {feedsLoading ? (
            <LoadingState label="Reading the resolver's feeds" />
          ) : (
            <div className="flex flex-col gap-3">
              <label className="form-control">
                <span className="label text-xs">Price feed</span>
                <select
                  className="select select-bordered w-full"
                  value={selected?.feedId ?? ""}
                  onChange={event => setFeedId(event.target.value as Hex)}
                >
                  {feeds.map(feed => (
                    <option key={feed.feedId} value={feed.feedId} disabled={!feed.allowed}>
                      {feed.label}
                      {feed.allowed ? "" : " (not allowed by the resolver)"}
                    </option>
                  ))}
                </select>
              </label>
              <p className="m-0 text-sm text-base-content/70">
                {live.answer !== undefined && selected
                  ? `${selected.label} is ${feedAnswerToPrice(live.answer, decimals, 6)} now, published ${live.updatedAt ? formatUtc(live.updatedAt) : ""}.`
                  : live.isError
                    ? `Could not read the feed: ${getParsedError(live.error)}`
                    : "Reading the live price."}
                {!resolverDeployed ? " The resolver is not deployed, so no feed can be used yet." : ""}
                {resolverDeployed && resolverAllowed.data === false ? " This resolver is not allowed by Verdict." : ""}
              </p>

              <div>
                <span className="label text-xs">Kind</span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {KINDS.map(option => (
                    <button
                      key={option}
                      type="button"
                      className={`btn btn-sm ${kind === option ? "btn-primary" : "btn-outline"}`}
                      onClick={() => setKind(option)}
                      title={KIND_DESCRIPTIONS[option]}
                    >
                      {KIND_LABELS[option]}
                    </button>
                  ))}
                </div>
                <p className="mt-2 mb-0 text-xs text-base-content/70">{KIND_DESCRIPTIONS[kind]}</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="form-control">
                  <span className="label text-xs">{kindUsesUpper(kind) ? "Lower bound" : "Strike"}</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={`input input-bordered w-full ${lowerText !== "" && lower === undefined ? "input-error" : ""}`}
                    placeholder={live.answer !== undefined ? feedAnswerToPrice(live.answer, decimals, 4) : "0.10"}
                    value={lowerText}
                    onChange={event => setLowerText(event.target.value)}
                  />
                </label>
                {kindUsesUpper(kind) ? (
                  <label className="form-control">
                    <span className="label text-xs">Upper bound</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      className={`input input-bordered w-full ${upperText !== "" && (upper === undefined || !boundsOk) ? "input-error" : ""}`}
                      placeholder="0.12"
                      value={upperText}
                      onChange={event => setUpperText(event.target.value)}
                    />
                  </label>
                ) : null}
              </div>
              {lower !== undefined && upper !== undefined && !boundsOk ? (
                <p className="m-0 text-xs text-error">The upper bound must be above the lower bound.</p>
              ) : null}

              <label className="form-control">
                <span className="label text-xs">Expiry (your local time, shown in UTC below)</span>
                <input
                  type="datetime-local"
                  className={`input input-bordered w-full ${expiry !== undefined && !expiryOk ? "input-error" : ""}`}
                  value={expiryLocal}
                  min={unixToLocalInput(earliest)}
                  max={unixToLocalInput(latest)}
                  onChange={event => setExpiryLocal(event.target.value)}
                />
              </label>
              <p className="m-0 text-xs text-base-content/70">
                {expiry !== undefined ? `${formatUtc(expiry)}. ` : ""}
                Must be at least {Math.round((earliest - now) / 60)} minutes ahead and at most{" "}
                {Math.round((latest - now) / 86_400)} days ahead, the scheduling horizon.
              </p>

              <div className="rounded-field bg-base-200 px-3 py-2 text-sm">
                {creationCost.data !== undefined ? (
                  <>
                    Creation costs {tinybarsToHbar(creationCost.data, 2)} HBAR: two HTS token creations plus the reserve
                    that pays the scheduled resolution. Anything not needed is refunded.
                  </>
                ) : creationCost.isError ? (
                  `Could not read the creation cost: ${getParsedError(creationCost.error)}`
                ) : (
                  "Reading the creation cost."
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {!account ? <p className="m-0 text-sm text-base-content/70">Connect a wallet to create.</p> : null}
                <button type="button" className="btn btn-primary btn-sm ml-auto" disabled={!canCreate} onClick={create}>
                  {verdictWrite.isMining ? <span className="loading loading-spinner loading-xs" /> : null}
                  Create market
                </button>
              </div>

              <div className="divider my-1 text-xs">or continue with an existing market</div>
              <label className="form-control">
                <span className="label text-xs">Market id</span>
                <input
                  type="text"
                  inputMode="numeric"
                  className="input input-bordered w-full"
                  placeholder="0"
                  value={marketIdText}
                  onChange={event => setMarketIdText(event.target.value)}
                />
              </label>
              {marketId !== undefined && created.status === "missing" ? (
                <p className="m-0 text-xs text-error">No such market.</p>
              ) : null}
              {step1Done && created.market ? (
                <p className="m-0 text-sm">
                  Market{" "}
                  <Link href={`/market/${marketId?.toString()}`} className="link">
                    #{marketId?.toString()}
                  </Link>
                  : YES <HashScanLink kind="token" value={created.market.yes} />, NO{" "}
                  <HashScanLink kind="token" value={created.market.no} />
                </p>
              ) : null}
            </div>
          )}
        </Step>

        <Step number={2} title="Split HBAR into YES and NO" done={step2Done}>
          <p className="m-0 mb-2 text-sm text-base-content/70">
            Your wallet must be associated with both tokens first. Splitting 20 HBAR gives you 20 YES and 20 NO.
          </p>
          <AmountInput
            value={splitText}
            onChange={setSplitText}
            unit="HBAR"
            invalid={splitText !== "" && splitAmount === undefined}
            disabled={!step1Done}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {step1Done && created.market && account && yesState.associated === false ? (
              <AssociateButton token={created.market.yes} label="YES" onDone={yesState.refetch} />
            ) : null}
            {step1Done && created.market && account && noState.associated === false ? (
              <AssociateButton token={created.market.no} label="NO" onDone={noState.refetch} />
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm ml-auto"
              disabled={
                !step1Done ||
                !account ||
                splitAmount === undefined ||
                yesState.associated === false ||
                noState.associated === false ||
                verdictWrite.isMining
              }
              onClick={split}
            >
              {verdictWrite.isMining ? <span className="loading loading-spinner loading-xs" /> : null}
              Split
            </button>
          </div>
          {step1Done && account ? (
            <p className="mt-2 mb-0 text-xs text-base-content/60">
              You hold {tokenUnitsToWhole(yesState.balance ?? 0n, 2)} YES and{" "}
              {tokenUnitsToWhole(noState.balance ?? 0n, 2)} NO.
            </p>
          ) : null}
        </Step>

        <Step number={3} title="Approve YES for the SaucerSwap router" done={step3Done}>
          <p className="m-0 mb-2 text-sm text-base-content/70">
            The router pulls the YES you add to the pool, so it needs an allowance.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <AmountInput
              value={yesLiquidityText}
              onChange={setYesLiquidityText}
              unit="YES"
              invalid={yesLiquidityText !== "" && yesLiquidity === undefined}
              disabled={!step1Done}
            />
            <AmountInput
              value={hbarLiquidityText}
              onChange={setHbarLiquidityText}
              unit="HBAR"
              invalid={hbarLiquidityText !== "" && hbarLiquidity === undefined}
              disabled={!step1Done}
            />
          </div>
          <p className="mt-2 mb-0 text-xs text-base-content/60">
            20 YES against 10 HBAR opens the pool at 0.5 HBAR per YES, which is even odds.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {step2Done && !step3Done && created.market && saucerRouter && yesLiquidity !== undefined ? (
              <ApproveButton
                token={created.market.yes}
                spender={saucerRouter.address}
                amount={yesLiquidity}
                label={`${tokenUnitsToWhole(yesLiquidity, 2)} YES`}
                onDone={yesState.refetch}
                className="ml-auto"
              />
            ) : null}
          </div>
        </Step>

        <Step number={4} title="Seed the pool" done={step4Done}>
          <p className="m-0 mb-2 text-sm text-base-content/70">
            Calls <code>addLiquidityETHNewPool</code> on the SaucerSwap router from your wallet. The value sent is the
            HBAR liquidity plus the pool creation fee
            {feeTinybars.data !== undefined ? ` (about ${tinybarsToHbar(feeTinybars.data, 2)} HBAR today)` : ""}. Your
            account needs a free automatic association slot for the LP token.
          </p>
          <p className="m-0 mb-2 text-sm font-medium">
            Seeding leaves you holding the NO leg: the YES goes into the pool, the NO stays in your wallet.
          </p>
          {feeTinybars.isError || pairFee.isError ? (
            <p className="m-0 mb-2 text-xs text-error">
              Could not read the pool creation fee: {getParsedError(feeTinybars.error ?? pairFee.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm ml-auto"
              disabled={
                !step3Done ||
                step4Done ||
                !account ||
                yesLiquidity === undefined ||
                hbarLiquidity === undefined ||
                (!created.hasPool && feeTinybars.data === undefined) ||
                saucerWrite.isMining
              }
              onClick={seed}
            >
              {saucerWrite.isMining ? <span className="loading loading-spinner loading-xs" /> : null}
              {created.hasPool ? "Add liquidity" : "Create pool and seed"}
            </button>
          </div>
          {step4Done && created.pair ? (
            <p className="mt-2 mb-0 text-sm">
              Pool live: <HashScanLink kind="contract" value={created.pair} />. See it on the{" "}
              <Link href={`/market/${marketId?.toString()}`} className="link">
                market page
              </Link>
              .
            </p>
          ) : null}
        </Step>
        <TxList hashes={hashes} />
      </div>

      <div className="flex flex-col gap-5 lg:col-span-2">
        <section className="rounded-box border border-base-300 bg-base-100 p-5">
          <h2 className="m-0 text-lg font-semibold">Preview</h2>
          <p className="mt-2 mb-3 font-semibold leading-snug">
            {selected && lower !== undefined && upper !== undefined && expiry !== undefined && boundsOk
              ? questionText({ feed: selected.label, kind, lower, upper, decimals, expiry })
              : "Pick a feed, a kind, the bounds and an expiry to see the question."}
          </p>
          {selected && lower !== undefined && upper !== undefined && boundsOk ? (
            <PayoffDiagram
              kind={kind}
              lower={lower}
              upper={upper}
              decimals={decimals}
              current={live.answer}
              feedLabel={selected.label}
            />
          ) : null}
        </section>
        <section className="rounded-box border border-base-300 bg-base-100 p-5 text-sm text-base-content/80">
          <h2 className="m-0 text-lg font-semibold">What happens</h2>
          <ol className="mt-2 mb-0 list-decimal space-y-1 pl-5">
            <li>Verdict creates the YES and NO tokens through HTS and schedules its own resolution through HSS.</li>
            <li>You split HBAR into equal YES and NO.</li>
            <li>You approve the SaucerSwap router to take the YES.</li>
            <li>You create the pool with YES against HBAR. Trading starts.</li>
          </ol>
        </section>
      </div>
    </div>
  );
};

const CreatePage: NextPage = () => (
  <div className="mx-auto w-full max-w-5xl px-4 py-8">
    <h1 className="m-0 text-3xl font-bold">Create a market</h1>
    <p className="mt-2 mb-6 text-sm text-base-content/70">
      Four transactions from your wallet: create, split, approve, seed. No free text goes on the ledger; the question is
      derived from the feed, the kind, the bounds and the expiry.
    </p>
    <Suspense fallback={<LoadingState label="Loading" />}>
      <CreateFlow />
    </Suspense>
  </div>
);

export default CreatePage;
