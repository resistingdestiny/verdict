import fc from "fast-check";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { MockHtsToken } from "../typechain-types";
import { now, ONE_HBAR, setTime } from "./helpers/hedera";
import { createMarket, Kind, RESERVE, Status, tokenAt } from "./helpers/verdict";
import { deployTrading, seedPool, type TradingContext } from "./helpers/trading";

/**
 * Property test: random sequences of every state-changing action, across several markets, kinds and
 * accounts, with the design's six invariants checked after every action.
 *
 * Runs only when VERDICT_PROPERTY=1 (`yarn hardhat:test:property`), so the unit suite stays fast. The
 * number of sequences is VERDICT_PROPERTY_RUNS, default 1000, and VERDICT_PROPERTY_SEED replays a run.
 * One fixture is deployed once and every sequence starts from a snapshot of it.
 */

const RUNS = Number(process.env.VERDICT_PROPERTY_RUNS ?? "1000");
const ENABLED = process.env.VERDICT_PROPERTY === "1";
/// Set VERDICT_PROPERTY_SEED to replay a run; fast-check prints the seed of a failing one.
const SEED = process.env.VERDICT_PROPERTY_SEED === undefined ? undefined : Number(process.env.VERDICT_PROPERTY_SEED);
const HOUR = 3600n;
const DAY = 24n * HOUR;
const TRADE_DEADLINE = HOUR;

// ---------------------------------------------------------------- action shapes

// fast-check biases small integers towards 0 and the edges; these need a flat distribution.
const market = fc.nat({ max: 19 }).noBias(); // modulo the markets made so far; 19 is "no such market"
const actor = fc.nat({ max: 2 }).noBias();
const rarely = fc
  .nat({ max: 9 })
  .noBias()
  .map(n => n === 0); // one time in ten
const percent = fc.nat({ max: 100 }).noBias();
const hbar = fc.bigInt({ min: ONE_HBAR / 100n, max: 5n * ONE_HBAR });

const action = fc.oneof(
  {
    arbitrary: fc.record({
      type: fc.constant("createMarket" as const),
      actor,
      kind: fc.nat({ max: 3 }).noBias(),
      lower: fc.bigInt({ min: 1n, max: 10n ** 12n }),
      width: fc.bigInt({ min: 0n, max: 10n ** 11n }),
      lead: fc.oneof(
        fc.bigInt({ min: 300n, max: 4n * HOUR }),
        fc.constant(DAY),
        fc.constant(100n),
        fc.constant(63n * DAY),
      ),
      extra: fc.bigInt({ min: 0n, max: ONE_HBAR }),
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      type: fc.constant("seedPool" as const),
      actor,
      market,
      yesAmount: fc.bigInt({ min: ONE_HBAR, max: 30n * ONE_HBAR }),
      hbarAmount: fc.bigInt({ min: ONE_HBAR, max: 30n * ONE_HBAR }),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      type: fc.constant("split" as const),
      actor,
      market,
      scatter: rarely,
      yesTo: actor,
      noTo: actor,
      amount: fc.oneof(fc.bigInt({ min: 1n, max: 1000n }), hbar, fc.constant(0n)),
    }),
    weight: 5,
  },
  {
    arbitrary: fc.record({
      type: fc.constant("merge" as const),
      actor,
      market,
      to: actor,
      percent,
      tiny: fc.boolean(),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      type: fc.constant("buyYes" as const),
      actor,
      market,
      value: hbar,
      slippageBps: fc.nat({ max: 500 }),
      tooTight: rarely,
      late: rarely,
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      type: fc.constant("sellYes" as const),
      actor,
      market,
      percent,
      slippageBps: fc.nat({ max: 500 }),
      tooTight: rarely,
      late: rarely,
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      type: fc.constant("buyNo" as const),
      actor,
      market,
      value: hbar,
      slippageBps: fc.nat({ max: 500 }),
      tooTight: rarely,
      late: rarely,
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      type: fc.constant("sellNo" as const),
      actor,
      market,
      percent,
      extra: fc.bigInt({ min: 0n, max: ONE_HBAR }),
      short: rarely,
      late: rarely,
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      type: fc.constant("timeTravel" as const),
      market,
      mode: fc.nat({ max: 5 }).noBias(),
      jitter: fc.bigInt({ min: 0n, max: 600n }),
    }),
    weight: 8,
  },
  {
    arbitrary: fc.record({
      type: fc.constant("pushRound" as const),
      answer: fc.bigInt({ min: -(10n ** 12n), max: 10n ** 12n }),
      positive: rarely.map(r => !r),
    }),
    weight: 4,
  },
  { arbitrary: fc.record({ type: fc.constant("resolve" as const), market }), weight: 3 },
  { arbitrary: fc.record({ type: fc.constant("resolveScheduled" as const), market }), weight: 3 },
  { arbitrary: fc.record({ type: fc.constant("voidMarket" as const), market }), weight: 2 },
  {
    arbitrary: fc.record({
      type: fc.constant("redeem" as const),
      actor,
      market,
      to: actor,
      yesPercent: percent,
      noPercent: percent,
    }),
    weight: 4,
  },
  { arbitrary: fc.record({ type: fc.constant("sweepSurplus" as const), to: actor }), weight: 1 },
  { arbitrary: fc.record({ type: fc.constant("strayHbar" as const), actor, amount: hbar }), weight: 1 },
);

type Action = typeof action extends fc.Arbitrary<infer T> ? T : never;

/** Only these actions move value through the router, so only they can leave something in it. */
const TRADES = new Set<Action["type"]>(["buyYes", "sellYes", "buyNo", "sellNo"]);

// ---------------------------------------------------------------- the world under test

type MarketState = {
  id: bigint;
  expiry: bigint;
  yes: MockHtsToken;
  no: MockHtsToken;
  yesAddress: string;
  noAddress: string;
  schedule: string;
  scheduleRun: boolean;
  pool: boolean;
  pair: string;
  status: bigint;
  payout: bigint | undefined;
};

/** Reasons a transaction may revert in this world. Anything else is a bug. */
const EXPECTED_REASON = /^(MockSaucerSwap(Router|Pair|Factory): |schedule finished$)/;

class World {
  readonly markets: MarketState[] = [];
  readonly actors: HardhatEthersSigner[];
  readonly outcomes = new Map<string, number>();

  constructor(
    readonly ctx: TradingContext,
    actors: HardhatEthersSigner[],
    markets: MarketState[],
  ) {
    this.actors = actors;
    this.markets = markets.map(m => ({ ...m }));
  }

  /** The model of a market as it stands on the ledger now. */
  static async load(ctx: TradingContext, id: bigint): Promise<MarketState> {
    const created = await ctx.verdict.getMarket(id);
    const pair = await ctx.router.pairOf(id);
    return {
      id,
      expiry: created.expiry,
      yes: await tokenAt(created.yes),
      no: await tokenAt(created.no),
      yesAddress: created.yes,
      noAddress: created.no,
      schedule: created.schedule,
      scheduleRun: false,
      pool: pair !== ethers.ZeroAddress,
      pair,
      status: created.status,
      payout: undefined,
    };
  }

  // -------------------------------------------------------------- actions

  async apply(a: Action): Promise<void> {
    const { ctx } = this;
    const { verdict, router } = ctx;
    const signer = "actor" in a ? this.actors[a.actor] : ctx.owner;
    const m =
      "market" in a && a.market < 19 && this.markets.length > 0
        ? this.markets[a.market % this.markets.length]
        : undefined;
    const bogus = BigInt(this.markets.length);
    const current = await now();

    switch (a.type) {
      case "createMarket": {
        const upper = a.lower + a.width;
        await this.attempt(
          `createMarket(${a.kind})`,
          verdict.connect(signer).createMarket(ctx.resolver, ctx.feedId, a.kind, a.lower, upper, current + a.lead, {
            value: ctx.creationCost + a.extra,
          }),
        );
        if ((await verdict.marketCount()) > bogus) this.markets.push(await World.load(ctx, bogus));
        return;
      }
      case "seedPool": {
        if (!m) {
          await this.split(signer, bogus, signer.address, signer.address, a.yesAmount);
          return;
        }
        const ok = await this.split(signer, m.id, signer.address, signer.address, a.yesAmount);
        if (!ok || m.pool) return;
        await ctx.hts.connect(signer).approve(m.yesAddress, ctx.saucerRouterAddress, a.yesAmount);
        const seeded = await this.attempt(
          "addLiquidityETHNewPool",
          ctx.saucerRouter
            .connect(signer)
            .addLiquidityETHNewPool(m.yesAddress, a.yesAmount, 0n, 0n, signer.address, current + TRADE_DEADLINE, {
              value: a.hbarAmount + ctx.poolFeeTinybars,
            }),
        );
        if (seeded) {
          m.pool = true;
          m.pair = await router.pairOf(m.id);
        }
        return;
      }
      case "split": {
        const yesTo = a.scatter ? this.actors[a.yesTo].address : signer.address;
        const noTo = a.scatter ? this.actors[a.noTo].address : signer.address;
        await this.split(signer, m?.id ?? bogus, yesTo, noTo, a.amount);
        return;
      }
      case "merge": {
        const merger = await this.holder(m, signer, (mm, who) => this.minHeld(mm, who));
        const held = m ? await this.minHeld(m, merger.address) : 1n;
        const amount = a.tiny ? (held < 1000n ? held : 1000n) : (held * BigInt(a.percent)) / 100n;
        if (m) {
          await m.yes.connect(merger).approve(ctx.verdictAddress, amount);
          await m.no.connect(merger).approve(ctx.verdictAddress, amount);
        }
        await this.attempt("merge", verdict.connect(merger).merge(m?.id ?? bogus, amount, this.actors[a.to].address));
        return;
      }
      case "buyYes": {
        const quote = m?.pool ? await router.quoteBuyYes(m.id, a.value) : 0n;
        const minOut = a.tooTight ? quote + 1n : (quote * BigInt(10_000 - a.slippageBps)) / 10_000n;
        const deadline = a.late ? current - 1n : current + TRADE_DEADLINE;
        await this.attempt(
          "buyYes",
          router.connect(signer).buyYes(m?.id ?? bogus, minOut, deadline, { value: a.value }),
        );
        return;
      }
      case "sellYes": {
        const seller = await this.holder(m, signer, (mm, who) => mm.yes.balanceOf(who));
        const held = m ? await m.yes.balanceOf(seller.address) : 0n;
        const yesIn = (held * BigInt(a.percent)) / 100n;
        const quote = m?.pool && yesIn > 0n ? await this.quoteOrZero(() => router.quoteSellYes(m.id, yesIn)) : 0n;
        const minOut = a.tooTight ? quote + 1n : (quote * BigInt(10_000 - a.slippageBps)) / 10_000n;
        const deadline = a.late ? current - 1n : current + TRADE_DEADLINE;
        if (m) await m.yes.connect(seller).approve(ctx.routerAddress, yesIn);
        await this.attempt("sellYes", router.connect(seller).sellYes(m?.id ?? bogus, yesIn, minOut, deadline));
        return;
      }
      case "buyNo": {
        const [, back] = m?.pool ? await this.quoteOrZeros(() => router.quoteBuyNo(m.id, a.value)) : [0n, 0n];
        const minBack = a.tooTight ? back + 1n : (back * BigInt(10_000 - a.slippageBps)) / 10_000n;
        const deadline = a.late ? current - 1n : current + TRADE_DEADLINE;
        await this.attempt(
          "buyNo",
          router.connect(signer).buyNo(m?.id ?? bogus, minBack, deadline, { value: a.value }),
        );
        return;
      }
      case "sellNo": {
        const seller = await this.holder(m, signer, (mm, who) => mm.no.balanceOf(who));
        const held = m ? await m.no.balanceOf(seller.address) : 0n;
        const noIn = (held * BigInt(a.percent)) / 100n;
        const [needed, net] =
          m?.pool && noIn > 0n ? await this.quoteOrZeros(() => router.quoteSellNo(m.id, noIn)) : [0n, 0n];
        const value = a.short && needed > 0n ? needed - 1n : needed + a.extra;
        const deadline = a.late ? current - 1n : current + TRADE_DEADLINE;
        if (m) await m.no.connect(seller).approve(ctx.routerAddress, noIn);
        await this.attempt("sellNo", router.connect(seller).sellNo(m?.id ?? bogus, noIn, net, deadline, { value }));
        return;
      }
      case "timeTravel": {
        // Modes: 0 and 1 a few minutes, 2 and 3 to a market's expiry, 4 past its void delay, 5 an hour.
        const target =
          !m || a.mode <= 1
            ? current + 60n + a.jitter
            : a.mode <= 3
              ? m.expiry + a.jitter
              : a.mode === 4
                ? m.expiry + DAY + 1n + a.jitter
                : current + HOUR + a.jitter;
        if (target > current) await setTime(target);
        return;
      }
      case "pushRound": {
        const answer = a.positive ? (a.answer < 0n ? -a.answer : a.answer) + 1n : a.answer;
        await ctx.feed.pushRound(answer, current);
        return;
      }
      case "resolve": {
        await this.attempt("resolve", verdict.resolve(m?.id ?? bogus));
        return;
      }
      case "resolveScheduled": {
        if (m && m.schedule !== ethers.ZeroAddress && !m.scheduleRun) {
          m.scheduleRun = true;
          await this.attempt("executeSchedule", ctx.hss.executeSchedule(m.schedule));
        } else {
          await this.attempt("resolveScheduled", verdict.resolveScheduled(m?.id ?? bogus));
        }
        return;
      }
      case "voidMarket": {
        await this.attempt("voidMarket", verdict.voidMarket(m?.id ?? bogus));
        return;
      }
      case "redeem": {
        const redeemer = await this.holder(
          m,
          signer,
          async (mm, who) => (await mm.yes.balanceOf(who)) + (await mm.no.balanceOf(who)),
        );
        const yesHeld = m ? await m.yes.balanceOf(redeemer.address) : 0n;
        const noHeld = m ? await m.no.balanceOf(redeemer.address) : 0n;
        const yesAmount = (yesHeld * BigInt(a.yesPercent)) / 100n;
        const noAmount = (noHeld * BigInt(a.noPercent)) / 100n;
        if (m) {
          await m.yes.connect(redeemer).approve(ctx.verdictAddress, yesAmount);
          await m.no.connect(redeemer).approve(ctx.verdictAddress, noAmount);
        }
        await this.attempt(
          "redeem",
          verdict.connect(redeemer).redeem(m?.id ?? bogus, yesAmount, noAmount, this.actors[a.to].address),
        );
        return;
      }
      case "sweepSurplus": {
        await this.attempt("sweepSurplus", verdict.connect(ctx.owner).sweepSurplus(this.actors[a.to].address));
        return;
      }
      case "strayHbar": {
        await signer.sendTransaction({ to: ctx.verdictAddress, value: a.amount });
        return;
      }
    }
  }

  private async split(signer: HardhatEthersSigner, id: bigint, yesTo: string, noTo: string, amount: bigint) {
    return this.attempt("split", this.ctx.verdict.connect(signer).split(id, yesTo, noTo, { value: amount }));
  }

  private async minHeld(m: MarketState, holder: string): Promise<bigint> {
    const yes = await m.yes.balanceOf(holder);
    const no = await m.no.balanceOf(holder);
    return yes < no ? yes : no;
  }

  /**
   * The preferred actor when they hold something of `m` by `measure`, else the actor holding the most.
   * Keeps sells, merges and redemptions from always landing on an empty account.
   */
  private async holder(
    m: MarketState | undefined,
    preferred: HardhatEthersSigner,
    measure: (m: MarketState, who: string) => Promise<bigint>,
  ): Promise<HardhatEthersSigner> {
    if (!m) return preferred;
    let best = preferred;
    let most = await measure(m, preferred.address);
    if (most > 0n) return preferred;
    for (const candidate of this.actors) {
      const held = await measure(m, candidate.address);
      if (held > most) [best, most] = [candidate, held];
    }
    return best;
  }

  /** A quote view that reverts (the pool cannot fill the amount) reads as zero, like the UI treats it. */
  private async quoteOrZero(quote: () => Promise<bigint>): Promise<bigint> {
    try {
      return await quote();
    } catch (e) {
      this.classify(e);
      return 0n;
    }
  }

  private async quoteOrZeros(quote: () => Promise<[bigint, bigint]>): Promise<[bigint, bigint]> {
    try {
      const [a, b] = await quote();
      return [a, b];
    } catch (e) {
      this.classify(e);
      return [0n, 0n];
    }
  }

  /** Runs a transaction. A revert with a known Verdict, router or mock reason is fine and counted. */
  private async attempt(label: string, tx: Promise<unknown>): Promise<boolean> {
    try {
      await tx;
      this.count(`${label}: ok`);
      return true;
    } catch (e) {
      this.count(`${label}: ${this.classify(e)}`);
      return false;
    }
  }

  private count(outcome: string): void {
    this.outcomes.set(outcome, (this.outcomes.get(outcome) ?? 0) + 1);
  }

  /** The name of a known revert, or a thrown error for anything the contracts are not meant to produce. */
  private classify(e: unknown): string {
    const data = (e as { data?: unknown }).data;
    if (typeof data !== "string") throw e;
    if (data.startsWith("0x08c379a0")) {
      const [reason] = ethers.AbiCoder.defaultAbiCoder().decode(["string"], "0x" + data.slice(10));
      if (EXPECTED_REASON.test(String(reason))) return String(reason);
      throw e;
    }
    for (const iface of [this.ctx.verdict.interface, this.ctx.router.interface]) {
      const parsed = iface.parseError(data);
      if (parsed) return parsed.name;
    }
    throw e;
  }

  // -------------------------------------------------------------- invariants

  /**
   * Invariants 1 to 4 after every action, read from state and supplies. Invariant 5 (state before
   * external calls, reentrancy guards) is a property of the code and is proved by the hostile
   * recipient tests in Verdict.test.ts; every payment here goes to plain accounts.
   */
  async check(step: string, afterTrade: boolean): Promise<void> {
    const { ctx } = this;
    const [balance, totalCollateral, pendingReserves, routerBalance] = await Promise.all([
      ethers.provider.getBalance(ctx.verdictAddress),
      ctx.verdict.totalCollateral(),
      ctx.verdict.pendingReserves(),
      ethers.provider.getBalance(ctx.routerAddress),
    ]);
    // 1. The balance covers collateral plus pending reserves.
    expect(balance, `${step}: balance covers collateral and reserves`).to.be.gte(totalCollateral + pendingReserves);
    // The router's own rule: it ends every transaction holding no HBAR and no outcome tokens.
    expect(routerBalance, `${step}: router holds no HBAR`).to.equal(0n);

    let summed = 0n;
    let open = 0n;
    for (const m of this.markets) {
      const [state, yesSupply, noSupply] = await Promise.all([
        ctx.verdict.getMarket(m.id),
        m.yes.totalSupply(),
        m.no.totalSupply(),
      ]);
      summed += state.collateral;
      if (state.status === BigInt(Status.Open)) {
        open += 1n;
        // 2. An open market's collateral equals both supplies.
        expect(state.collateral, `${step}: market ${m.id} collateral equals YES supply`).to.equal(yesSupply);
        expect(state.collateral, `${step}: market ${m.id} collateral equals NO supply`).to.equal(noSupply);
        expect(state.reserve, `${step}: open market keeps its reserve`).to.equal(RESERVE);
      } else {
        // 3. A settled market's collateral covers every outstanding redemption.
        const owed = yesSupply * state.payout + noSupply * (ONE_HBAR - state.payout);
        expect(state.collateral * ONE_HBAR, `${step}: market ${m.id} collateral covers redemptions`).to.be.gte(owed);
        expect(state.reserve, `${step}: settled market released its reserve`).to.equal(0n);
        // 4. A payout is written once and never changes, and a market never reopens.
        if (m.payout === undefined) {
          m.payout = state.payout;
          m.status = state.status;
        }
        expect(state.payout, `${step}: market ${m.id} payout never changes`).to.equal(m.payout);
        expect(state.status, `${step}: market ${m.id} never changes status again`).to.equal(m.status);
        expect(state.payout, `${step}: payout within one HBAR`).to.be.lte(ONE_HBAR);
      }
      if (afterTrade) {
        expect(await m.yes.balanceOf(ctx.routerAddress), `${step}: router holds no YES`).to.equal(0n);
        expect(await m.no.balanceOf(ctx.routerAddress), `${step}: router holds no NO`).to.equal(0n);
      }
    }
    expect(summed, `${step}: totalCollateral is the sum over markets`).to.equal(totalCollateral);
    expect(pendingReserves, `${step}: pendingReserves is one reserve per open market`).to.equal(open * RESERVE);
  }

  /** 6. Verdict grants no allowance on any outcome token to the DEX, a pair or the trade router. */
  async checkNoDexAllowance(): Promise<void> {
    const { ctx } = this;
    for (const m of this.markets) {
      for (const spender of [ctx.saucerRouterAddress, ctx.routerAddress, m.pair]) {
        if (spender === ethers.ZeroAddress) continue;
        expect(await m.yes.allowance(ctx.verdictAddress, spender), "no allowance on YES").to.equal(0n);
        expect(await m.no.allowance(ctx.verdictAddress, spender), "no allowance on NO").to.equal(0n);
      }
    }
  }
}

// ---------------------------------------------------------------- the property

(ENABLED ? describe : describe.skip)("Invariants (property)", function () {
  let ctx: TradingContext;
  let actors: HardhatEthersSigner[];
  let base: string;
  let seeded: MarketState[];
  const totals = new Map<string, number>();
  let sequences = 0;
  let actionsRun = 0;

  before(async function () {
    ctx = await deployTrading();
    actors = [ctx.alice, ctx.bob, ctx.carol];
    // A first round so the feed has history; whether it is fresh at any expiry is up to the sequence.
    await ctx.feed.pushRound(1_000_00000000n, await now());
    // Two markets exist from the start, one with a pool, so trades, settlement and voiding are reachable early.
    const start = await now();
    await createMarket(ctx, { kind: Kind.Above, lower: 1_000_00000000n, expiry: start + HOUR, creator: ctx.alice });
    await seedPool(ctx, ctx.alice, 0n, 20n * ONE_HBAR, 10n * ONE_HBAR);
    await createMarket(ctx, {
      kind: Kind.Scalar,
      lower: 900_00000000n,
      upper: 1_100_00000000n,
      expiry: start + 8n * HOUR, // beyond the feed's six hours of staleness, so it can void
      creator: ctx.bob,
    });
    seeded = [await World.load(ctx, 0n), await World.load(ctx, 1n)];
    base = await network.provider.send("evm_snapshot", []);
  });

  after(function () {
    const lines = [...totals.entries()].sort().map(([k, v]) => `      ${k}: ${v}`);
    console.log(`      ${sequences} sequences, ${actionsRun} actions, outcomes:\n${lines.join("\n")}`);
  });

  it(`holds the six invariants across ${RUNS} random action sequences`, async function () {
    await fc.assert(
      fc.asyncProperty(fc.array(action, { minLength: 8, maxLength: 20 }), async actions => {
        await network.provider.send("evm_revert", [base]);
        base = await network.provider.send("evm_snapshot", []);
        const world = new World(ctx, actors, seeded);
        for (const [i, a] of actions.entries()) {
          await world.apply(a);
          await world.check(`step ${i} ${a.type}`, TRADES.has(a.type));
        }
        await world.checkNoDexAllowance();
        sequences += 1;
        actionsRun += actions.length;
        for (const [k, v] of world.outcomes) totals.set(k, (totals.get(k) ?? 0) + v);
      }),
      { numRuns: RUNS, seed: SEED, verbose: true },
    );
  });
});
