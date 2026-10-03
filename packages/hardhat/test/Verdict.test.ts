import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { now, ONE_HBAR, setBalance, setNextTime, setTime } from "./helpers/hedera";
import {
  approveBoth,
  createMarket,
  DAY,
  deployVerdict,
  expectInvariants,
  HOUR,
  INT64_MAX,
  Kind,
  pushRound,
  RESERVE,
  SIX_HOURS,
  Status,
  tokenAt,
} from "./helpers/verdict";

const HALF = ONE_HBAR / 2n;
const CODE_INVALID_SIGNATURE = 7n;
const CODE_INSUFFICIENT_TX_FEE = 9n;
const CODE_INSUFFICIENT_TOKEN_BALANCE = 178n;
const CODE_SPENDER_DOES_NOT_HAVE_ALLOWANCE = 292n;
const CODE_AMOUNT_EXCEEDS_ALLOWANCE = 293n;
const CODE_SCHEDULE_TOO_FAR = 306n;
const CODE_SCHEDULE_EXPIRY_BUSY = 370n;

describe("Verdict", function () {
  describe("constants and construction", function () {
    it("exposes the lead, delay and reserve constants the brief fixes", async function () {
      const { verdict } = await loadFixture(deployVerdict);
      expect(await verdict.MIN_LEAD()).to.equal(5n * 60n);
      expect(await verdict.MAX_LEAD()).to.equal(62n * DAY);
      expect(await verdict.VOID_DELAY()).to.equal(DAY);
      expect(await verdict.RESOLUTION_RESERVE()).to.equal(RESERVE);
      expect(await verdict.RESOLVE_GAS()).to.equal(2_000_000n);
      expect(await verdict.tokenCreateValue()).to.equal(ONE_HBAR);
    });

    it("creationCost is two token creation values plus the resolution reserve", async function () {
      const { verdict, owner, bob } = await loadFixture(deployVerdict);
      expect(await verdict.creationCost()).to.equal(2n * ONE_HBAR + RESERVE);
      await expect(verdict.connect(owner).setTokenCreateValue(2n * ONE_HBAR))
        .to.emit(verdict, "TokenCreateValueSet")
        .withArgs(2n * ONE_HBAR);
      expect(await verdict.creationCost()).to.equal(4n * ONE_HBAR + RESERVE);
      await expect(verdict.connect(bob).setTokenCreateValue(1n)).to.be.revertedWithCustomError(
        verdict,
        "OwnableUnauthorizedAccount",
      );
    });

    it("only the owner allows resolvers, and the change is an event", async function () {
      const { verdict, owner, bob } = await loadFixture(deployVerdict);
      await expect(verdict.connect(owner).setResolver(bob.address, true))
        .to.emit(verdict, "ResolverSet")
        .withArgs(bob.address, true);
      expect(await verdict.resolverAllowed(bob.address)).to.equal(true);
      await expect(verdict.connect(bob).setResolver(bob.address, false)).to.be.revertedWithCustomError(
        verdict,
        "OwnableUnauthorizedAccount",
      );
    });

    it("getMarket reverts NoSuchMarket for an id that does not exist", async function () {
      const { verdict } = await loadFixture(deployVerdict);
      await expect(verdict.getMarket(0)).to.be.revertedWithCustomError(verdict, "NoSuchMarket").withArgs(0);
    });
  });

  describe("createMarket", function () {
    it("creates YES and NO through HTS with this contract as treasury and supply key, and schedules resolution", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hss, hts, alice, resolver, feedId } = ctx;
      const expiry = (await now()) + HOUR;
      const verdictAddress = await verdict.getAddress();
      await expect(
        verdict
          .connect(alice)
          .createMarket(resolver, feedId, Kind.Above, 1000n, 0n, expiry, { value: ctx.creationCost }),
      )
        .to.emit(verdict, "MarketCreated")
        .withArgs(
          0,
          alice.address,
          await resolver.getAddress(),
          feedId,
          Kind.Above,
          1000n,
          0n,
          expiry,
          8,
          anyValue,
          anyValue,
          anyValue,
          RESERVE,
        );
      const m = await verdict.getMarket(0);
      expect(await verdict.marketCount()).to.equal(1n);
      expect(m.creator).to.equal(alice.address);
      expect(m.status).to.equal(Status.Open);
      expect(m.decimals).to.equal(8);
      expect(m.reserve).to.equal(RESERVE);
      expect(m.schedule).to.not.equal(ethers.ZeroAddress);
      expect(await hts.tokenCount()).to.equal(2n);

      const yes = await tokenAt(m.yes);
      const no = await tokenAt(m.no);
      expect(await yes.name()).to.equal("Verdict YES 0");
      expect(await yes.symbol()).to.equal("VYES0");
      expect(await no.name()).to.equal("Verdict NO 0");
      expect(await no.symbol()).to.equal("VNO0");
      expect(await yes.decimals()).to.equal(8n);
      expect(await yes.treasury()).to.equal(verdictAddress);
      expect(await yes.supplyKey()).to.equal(verdictAddress);
      expect(await no.treasury()).to.equal(verdictAddress);

      const scheduled = await hss.scheduleAt(m.schedule);
      expect(scheduled.to).to.equal(verdictAddress);
      expect(scheduled.payer).to.equal(verdictAddress);
      expect(scheduled.expirySecond).to.equal(expiry);
      expect(scheduled.gasLimit).to.equal(2_000_000n);
      expect(scheduled.callData).to.equal(verdict.interface.encodeFunctionData("resolveScheduled", [0]));
      expect(await verdict.pendingReserves()).to.equal(RESERVE);
      await expectInvariants(ctx, [0n]);
    });

    it("charges what HTS actually consumed plus the reserve and refunds the rest of msg.value", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hts, alice, resolver, feedId } = ctx;
      const expiry = (await now()) + HOUR;
      const sent = 10n * ONE_HBAR;
      // The mock fee is 1 HBAR per token, the same as tokenCreateValue: 2 HBAR consumed, 5 HBAR reserved.
      await expect(
        verdict.connect(alice).createMarket(resolver, feedId, Kind.Above, 1n, 0n, expiry, { value: sent }),
      ).to.changeEtherBalances([alice, verdict, hts], [-(2n * ONE_HBAR + RESERVE), RESERVE, 2n * ONE_HBAR]);

      // A cheaper fee means a smaller charge, even though the same value is sent with each creation.
      await hts.setCreateFee(ONE_HBAR / 4n);
      await expect(
        verdict.connect(alice).createMarket(resolver, feedId, Kind.Above, 1n, 0n, expiry, { value: sent }),
      ).to.changeEtherBalances([alice, verdict, hts], [-(ONE_HBAR / 2n + RESERVE), RESERVE, ONE_HBAR / 2n]);

      // If HTS keeps the whole value, the creator pays the whole value.
      await hts.setKeepExcess(true);
      await expect(
        verdict.connect(alice).createMarket(resolver, feedId, Kind.Above, 1n, 0n, expiry, { value: sent }),
      ).to.changeEtherBalances([alice, verdict, hts], [-(2n * ONE_HBAR + RESERVE), RESERVE, 2n * ONE_HBAR]);
      expect(await verdict.pendingReserves()).to.equal(3n * RESERVE);
      await expectInvariants(ctx, [0n, 1n, 2n]);
    });

    it("reverts InsufficientValue below creationCost and ResolverNotAllowed for a stranger resolver", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, alice, bob, resolver, feedId, creationCost } = ctx;
      const expiry = (await now()) + HOUR;
      await expect(
        verdict.connect(alice).createMarket(resolver, feedId, Kind.Above, 1n, 0n, expiry, { value: creationCost - 1n }),
      )
        .to.be.revertedWithCustomError(verdict, "InsufficientValue")
        .withArgs(creationCost, creationCost - 1n);
      await expect(
        verdict.connect(alice).createMarket(bob.address, feedId, Kind.Above, 1n, 0n, expiry, { value: creationCost }),
      )
        .to.be.revertedWithCustomError(verdict, "ResolverNotAllowed")
        .withArgs(bob.address);
    });

    it("enforces the 5 minute minimum and 62 day maximum lead", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, alice, resolver, feedId, creationCost } = ctx;
      // Pin the second each call lands in, so the bounds are exact whatever the wall clock does.
      const at = (await now()) + 100n;
      await setNextTime(at);
      await expect(
        verdict.connect(alice).createMarket(resolver, feedId, Kind.Above, 1n, 0n, at + 299n, { value: creationCost }),
      )
        .to.be.revertedWithCustomError(verdict, "ExpiryTooSoon")
        .withArgs(at + 299n, at + 300n);
      await setNextTime(at + 100n);
      await expect(
        verdict
          .connect(alice)
          .createMarket(resolver, feedId, Kind.Above, 1n, 0n, at + 100n + 62n * DAY + 1n, { value: creationCost }),
      )
        .to.be.revertedWithCustomError(verdict, "ExpiryTooFar")
        .withArgs(at + 100n + 62n * DAY + 1n, at + 100n + 62n * DAY);
      await setNextTime(at + 200n);
      await createMarket(ctx, { kind: Kind.Above, lower: 1n, expiry: at + 200n + 300n });
      await setNextTime(at + 300n);
      await createMarket(ctx, { kind: Kind.Above, lower: 1n, expiry: at + 300n + 62n * DAY });
      expect(await verdict.marketCount()).to.equal(2n);
    });

    it("validates bounds per kind: Between and Scalar need upper > lower, Above and Below store upper as 0", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, alice, resolver, feedId, creationCost } = ctx;
      const expiry = (await now()) + HOUR;
      for (const kind of [Kind.Between, Kind.Scalar]) {
        await expect(
          verdict.connect(alice).createMarket(resolver, feedId, kind, 100n, 100n, expiry, { value: creationCost }),
        ).to.be.revertedWithCustomError(verdict, "InvalidBounds");
        await expect(
          verdict.connect(alice).createMarket(resolver, feedId, kind, 100n, 99n, expiry, { value: creationCost }),
        ).to.be.revertedWithCustomError(verdict, "InvalidBounds");
      }
      const above = await createMarket(ctx, { kind: Kind.Above, lower: 100n, upper: 5n });
      const below = await createMarket(ctx, { kind: Kind.Below, lower: 100n, upper: 5n });
      const between = await createMarket(ctx, { kind: Kind.Between, lower: 100n, upper: 101n });
      expect((await verdict.getMarket(above.id)).upper).to.equal(0n);
      expect((await verdict.getMarket(below.id)).upper).to.equal(0n);
      expect((await verdict.getMarket(between.id)).upper).to.equal(101n);
    });

    it("refuses a feed the resolver does not know, with the resolver's own error", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, alice, resolver, creationCost } = ctx;
      const unknown = ethers.zeroPadValue(alice.address, 32);
      await expect(
        verdict
          .connect(alice)
          .createMarket(resolver, unknown, Kind.Above, 1n, 0n, (await now()) + HOUR, { value: creationCost }),
      )
        .to.be.revertedWithCustomError(resolver, "UnknownFeed")
        .withArgs(unknown);
    });
  });

  describe("payoff tables (brief item 2)", function () {
    const FULL = ONE_HBAR;
    const tables: { kind: Kind; lower: bigint; upper: bigint; rows: [bigint, bigint][] }[] = [
      {
        kind: Kind.Above,
        lower: 1000n,
        upper: 0n,
        rows: [
          [999n, 0n],
          [1000n, 0n],
          [1001n, FULL],
          [-5n, 0n],
        ],
      },
      {
        kind: Kind.Below,
        lower: 1000n,
        upper: 0n,
        rows: [
          [999n, FULL],
          [1000n, 0n],
          [1001n, 0n],
          [-5n, FULL],
        ],
      },
      {
        kind: Kind.Between,
        lower: 1000n,
        upper: 2000n,
        rows: [
          [999n, 0n],
          [1000n, FULL],
          [1001n, FULL],
          [1500n, FULL],
          [1999n, FULL],
          [2000n, 0n],
          [2001n, 0n],
        ],
      },
      {
        kind: Kind.Scalar,
        lower: 1000n,
        upper: 2000n,
        rows: [
          [999n, 0n],
          [1000n, 0n],
          [1001n, 100_000n],
          [1500n, HALF],
          [1999n, 99_900_000n],
          [2000n, FULL],
          [2001n, FULL],
        ],
      },
    ];
    for (const table of tables) {
      it(`${Kind[table.kind]} pays by the brief's rule at each bound, just either side, and the midpoint`, async function () {
        const { verdict } = await loadFixture(deployVerdict);
        for (const [answer, expected] of table.rows) {
          expect(await verdict.payoutFor(table.kind, table.lower, table.upper, answer), `answer ${answer}`).to.equal(
            expected,
          );
        }
      });
    }

    it("Scalar with negative bounds interpolates in the same straight line", async function () {
      const { verdict } = await loadFixture(deployVerdict);
      expect(await verdict.payoutFor(Kind.Scalar, -1000n, 1000n, 0n)).to.equal(HALF);
      expect(await verdict.payoutFor(Kind.Scalar, -1000n, 1000n, -500n)).to.equal(25_000_000n);
    });
  });

  describe("full lifecycle per kind (brief item 1)", function () {
    const cases = [
      { kind: Kind.Above, lower: 1000n, upper: 0n, answer: 1500n, payout: ONE_HBAR },
      { kind: Kind.Below, lower: 1000n, upper: 0n, answer: 1500n, payout: 0n },
      { kind: Kind.Between, lower: 1000n, upper: 2000n, answer: 1500n, payout: ONE_HBAR },
      { kind: Kind.Scalar, lower: 1000n, upper: 2000n, answer: 1250n, payout: 25_000_000n },
    ];
    for (const c of cases) {
      it(`${Kind[c.kind]}: create, split, merge, scheduled resolve, redeem, with collateral and supply checked at each step`, async function () {
        const ctx = await loadFixture(deployVerdict);
        const { verdict, hss, feed, alice, bob } = ctx;
        const { id, expiry, yes, no } = await createMarket(ctx, { kind: c.kind, lower: c.lower, upper: c.upper });
        await expectInvariants(ctx, [id]);

        const stake = 10n * ONE_HBAR;
        await expect(verdict.connect(alice).split(id, alice.address, alice.address, { value: stake }))
          .to.emit(verdict, "Split")
          .withArgs(id, alice.address, stake, alice.address, alice.address);
        expect((await verdict.getMarket(id)).collateral).to.equal(stake);
        expect(await verdict.totalCollateral()).to.equal(stake);
        expect(await yes.totalSupply()).to.equal(stake);
        expect(await no.totalSupply()).to.equal(stake);
        expect(await yes.balanceOf(alice.address)).to.equal(stake);
        await expectInvariants(ctx, [id]);

        const merged = 2n * ONE_HBAR;
        await approveBoth(ctx, alice, yes, no, merged);
        const tx = await verdict.connect(alice).merge(id, merged, bob.address);
        await expect(tx).to.emit(verdict, "Merged").withArgs(id, alice.address, merged, bob.address);
        await expect(tx).to.changeEtherBalances([verdict, bob], [-merged, merged]);
        const held = stake - merged;
        expect((await verdict.getMarket(id)).collateral).to.equal(held);
        expect(await yes.totalSupply()).to.equal(held);
        expect(await no.totalSupply()).to.equal(held);
        await expectInvariants(ctx, [id]);

        const roundId = await pushRound(feed, c.answer, expiry - 10n);
        await setTime(expiry);
        const schedule = (await verdict.getMarket(id)).schedule;
        await expect(hss.executeSchedule(schedule))
          .to.emit(verdict, "Resolved")
          .withArgs(id, c.payout, c.answer, roundId, expiry - 10n, true);
        const settled = await verdict.getMarket(id);
        expect(settled.status).to.equal(Status.Settled);
        expect(settled.payout).to.equal(c.payout);
        expect(settled.answer).to.equal(c.answer);
        expect(settled.roundId).to.equal(roundId);
        expect(settled.updatedAt).to.equal(expiry - 10n);
        expect(settled.settledBySchedule).to.equal(true);
        expect(settled.reserve).to.equal(0n);
        expect(await verdict.pendingReserves()).to.equal(0n);
        expect(settled.collateral).to.equal(held);
        await expectInvariants(ctx, [id]);

        await approveBoth(ctx, alice, yes, no, held);
        const yesValue = (held * c.payout) / ONE_HBAR;
        const noValue = (held * (ONE_HBAR - c.payout)) / ONE_HBAR;
        const redeemYes = await verdict.connect(alice).redeem(id, held, 0n, alice.address);
        await expect(redeemYes)
          .to.emit(verdict, "Redeemed")
          .withArgs(id, alice.address, held, 0n, yesValue, alice.address);
        await expect(redeemYes).to.changeEtherBalances([verdict, alice], [-yesValue, yesValue]);
        expect(await yes.totalSupply()).to.equal(0n);
        await expectInvariants(ctx, [id]);
        const redeemNo = await verdict.connect(alice).redeem(id, 0n, held, alice.address);
        await expect(redeemNo)
          .to.emit(verdict, "Redeemed")
          .withArgs(id, alice.address, 0n, held, noValue, alice.address);
        await expect(redeemNo).to.changeEtherBalances([verdict, alice], [-noValue, noValue]);
        expect(await no.totalSupply()).to.equal(0n);
        expect((await verdict.getMarket(id)).collateral).to.equal(0n);
        expect(await verdict.totalCollateral()).to.equal(0n);
        expect(await ethers.provider.getBalance(await verdict.getAddress())).to.equal(RESERVE);
        await expectInvariants(ctx, [id]);
      });
    }
  });

  describe("split and merge (brief item 3)", function () {
    it("split then merge conserves collateral and both supplies, and merge works in any state", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed, alice, bob, carol } = ctx;
      const { id, expiry, yes, no } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await verdict.connect(alice).split(id, bob.address, carol.address, { value: 5n * ONE_HBAR });
      expect(await yes.balanceOf(bob.address)).to.equal(5n * ONE_HBAR);
      expect(await no.balanceOf(carol.address)).to.equal(5n * ONE_HBAR);
      await verdict.connect(alice).split(id, alice.address, alice.address, { value: 3n * ONE_HBAR });
      expect((await verdict.getMarket(id)).collateral).to.equal(8n * ONE_HBAR);
      await approveBoth(ctx, alice, yes, no, 3n * ONE_HBAR);
      await verdict.connect(alice).merge(id, 2n * ONE_HBAR, alice.address);
      expect((await verdict.getMarket(id)).collateral).to.equal(6n * ONE_HBAR);
      expect(await yes.totalSupply()).to.equal(6n * ONE_HBAR);
      expect(await no.totalSupply()).to.equal(6n * ONE_HBAR);
      await expectInvariants(ctx, [id]);

      await pushRound(feed, 2n, expiry);
      await setTime(expiry + 1n);
      await verdict.resolve(id);
      await expect(verdict.connect(alice).merge(id, ONE_HBAR, alice.address)).to.changeEtherBalances(
        [verdict, alice],
        [-ONE_HBAR, ONE_HBAR],
      );
      expect((await verdict.getMarket(id)).collateral).to.equal(5n * ONE_HBAR);
      await expectInvariants(ctx, [id]);
    });

    it("split after expiry reverts MarketNotOpen, and so does split on a settled market", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed, alice } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await setTime(expiry - 2n);
      await verdict.connect(alice).split(id, alice.address, alice.address, { value: 1n });
      await setTime(expiry);
      await expect(verdict.connect(alice).split(id, alice.address, alice.address, { value: 1n }))
        .to.be.revertedWithCustomError(verdict, "MarketNotOpen")
        .withArgs(id);
      await pushRound(feed, 2n, expiry);
      await verdict.resolve(id);
      await expect(
        verdict.connect(alice).split(id, alice.address, alice.address, { value: 1n }),
      ).to.be.revertedWithCustomError(verdict, "MarketNotOpen");
    });

    it("split rejects zero value, values beyond int64 and unknown markets", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, alice } = ctx;
      const { id } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await expect(verdict.connect(alice).split(id, alice.address, alice.address)).to.be.revertedWithCustomError(
        verdict,
        "ZeroAmount",
      );
      await expect(
        verdict.connect(alice).split(id, alice.address, alice.address, { value: INT64_MAX + 1n }),
      ).to.be.revertedWithCustomError(verdict, "AmountTooLarge");
      await expect(verdict.connect(alice).split(7, alice.address, alice.address, { value: 1n }))
        .to.be.revertedWithCustomError(verdict, "NoSuchMarket")
        .withArgs(7);
    });

    it("merge rejects zero, more than the market's collateral, and more than int64", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, alice } = ctx;
      const { id } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await verdict.connect(alice).split(id, alice.address, alice.address, { value: 10n });
      await expect(verdict.connect(alice).merge(id, 0n, alice.address)).to.be.revertedWithCustomError(
        verdict,
        "ZeroAmount",
      );
      await expect(verdict.connect(alice).merge(id, 11n, alice.address)).to.be.revertedWithCustomError(
        verdict,
        "AmountTooLarge",
      );
      await expect(verdict.connect(alice).merge(id, INT64_MAX + 1n, alice.address)).to.be.revertedWithCustomError(
        verdict,
        "AmountTooLarge",
      );
    });
  });

  describe("resolve and resolveScheduled (brief items 4 and 5)", function () {
    it("resolve before expiry reverts MarketNotExpired and a second resolve reverts MarketNotOpen", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await pushRound(feed, 2n, await now());
      await expect(verdict.resolve(id)).to.be.revertedWithCustomError(verdict, "MarketNotExpired").withArgs(id);
      await setTime(expiry);
      await expect(verdict.resolve(id))
        .to.emit(verdict, "Resolved")
        .withArgs(id, ONE_HBAR, 2n, anyValue, anyValue, false);
      await expect(verdict.resolve(id)).to.be.revertedWithCustomError(verdict, "MarketNotOpen").withArgs(id);
      await expect(verdict.resolve(42)).to.be.revertedWithCustomError(verdict, "NoSuchMarket").withArgs(42);
      expect((await verdict.getMarket(id)).settledBySchedule).to.equal(false);
    });

    it("settles on the round current at expiry even when later rounds exist", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1000n });
      await pushRound(feed, 900n, expiry - 200n);
      const current = await pushRound(feed, 1100n, expiry - 50n);
      await setTime(expiry + 100n);
      await pushRound(feed, 500n, expiry + 1n);
      await pushRound(feed, 400n, expiry + 60n);
      await expect(verdict.resolve(id))
        .to.emit(verdict, "Resolved")
        .withArgs(id, ONE_HBAR, 1100n, current, expiry - 50n, false);
    });

    it("a payout is written once: nothing can change it after settlement", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hss, feed } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1000n });
      await pushRound(feed, 1100n, expiry - 1n);
      await setTime(expiry);
      await verdict.resolve(id);
      await pushRound(feed, 1n, expiry);
      await expect(verdict.resolve(id)).to.be.revertedWithCustomError(verdict, "MarketNotOpen");
      // The manual settlement deleted the schedule, so the network never runs it; a direct call to
      // resolveScheduled, by anyone, finds the market settled and changes nothing.
      expect((await hss.scheduleAt((await verdict.getMarket(id)).schedule)).deleted).to.equal(true);
      await expect(verdict.resolveScheduled(id)).to.emit(verdict, "ResolveDeferred").withArgs(id, "already settled");
      await setTime(expiry + DAY);
      await expect(verdict.voidMarket(id)).to.be.revertedWithCustomError(verdict, "MarketNotOpen");
      expect((await verdict.getMarket(id)).payout).to.equal(ONE_HBAR);
    });

    it("resolveScheduled never reverts and names its reason", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await expect(verdict.resolveScheduled(99)).to.emit(verdict, "ResolveDeferred").withArgs(99, "no such market");
      await expect(verdict.resolveScheduled(id)).to.emit(verdict, "ResolveDeferred").withArgs(id, "not expired");
      await setTime(expiry);
      await expect(verdict.resolveScheduled(id)).to.emit(verdict, "ResolveDeferred").withArgs(id, "no fresh reading");
      await pushRound(feed, 2n, expiry);
      await expect(verdict.resolveScheduled(id))
        .to.emit(verdict, "Resolved")
        .withArgs(id, ONE_HBAR, 2n, anyValue, expiry, true);
      await expect(verdict.resolveScheduled(id)).to.emit(verdict, "ResolveDeferred").withArgs(id, "already settled");
    });

    it("a resolver that reverts counts as no reading for resolve, resolveScheduled and voidMarket", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, owner, alice, creationCost } = ctx;
      const failing = await (await ethers.getContractFactory("MockFailingResolver")).deploy();
      await verdict.connect(owner).setResolver(failing, true);
      const expiry = (await now()) + HOUR;
      await verdict
        .connect(alice)
        .createMarket(failing, ethers.ZeroHash, Kind.Above, 0n, 0n, expiry, { value: creationCost });
      await failing.setReverting(true);
      await setTime(expiry);
      await expect(verdict.resolve(0)).to.be.revertedWithCustomError(verdict, "NoFreshReading").withArgs(0);
      await expect(verdict.resolveScheduled(0)).to.emit(verdict, "ResolveDeferred").withArgs(0, "no fresh reading");
      await setTime(expiry + DAY);
      await failing.setReverting(false);
      await expect(verdict.voidMarket(0)).to.be.revertedWithCustomError(verdict, "FreshReadingExists");
      await failing.setReverting(true);
      await expect(verdict.voidMarket(0)).to.emit(verdict, "Voided").withArgs(0, owner.address);
    });
  });

  describe("schedule cleanup on settlement (review M2)", function () {
    it("a manual resolve deletes the pending schedule before the reserve is released", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hss, feed, owner, bob } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      const schedule = (await verdict.getMarket(id)).schedule;
      expect((await hss.scheduleAt(schedule)).deleted).to.equal(false);
      await pushRound(feed, 2n, expiry);
      await setTime(expiry + 1n);
      await expect(verdict.resolve(id)).to.emit(verdict, "Resolved");
      const scheduled = await hss.scheduleAt(schedule);
      expect(scheduled.deleted).to.equal(true);
      expect(scheduled.executed).to.equal(false);
      expect((await verdict.getMarket(id)).schedule, "the schedule address stays as a record").to.equal(schedule);
      expect(await verdict.pendingReserves()).to.equal(0n);
      // The network cannot run a deleted schedule, so the swept reserve can never be charged afterwards.
      await expect(hss.executeSchedule(schedule)).to.be.revertedWith("schedule finished");
      await expect(verdict.connect(owner).sweepSurplus(bob.address)).to.changeEtherBalance(bob, RESERVE);
      await expectInvariants(ctx, [id]);
    });

    it("voidMarket deletes the pending schedule too", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hss } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      const schedule = (await verdict.getMarket(id)).schedule;
      await setTime(expiry + DAY);
      await expect(verdict.voidMarket(id)).to.emit(verdict, "Voided");
      expect((await hss.scheduleAt(schedule)).deleted).to.equal(true);
      await expect(hss.executeSchedule(schedule)).to.be.revertedWith("schedule finished");
    });

    it("a settlement by the schedule is not double-handled and the reserve covers the run's charge", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hss, feed, alice, owner, bob } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await verdict.connect(alice).split(id, alice.address, alice.address, { value: 3n * ONE_HBAR });
      const schedule = (await verdict.getMarket(id)).schedule;
      const verdictAddress = await verdict.getAddress();
      // Until the run, the reserve is pending and nothing above collateral plus reserves exists to sweep.
      await expect(verdict.connect(owner).sweepSurplus(bob.address)).to.be.revertedWithCustomError(
        verdict,
        "NothingToSweep",
      );
      await pushRound(feed, 2n, expiry);
      await setTime(expiry + 1n);
      await expect(hss.executeSchedule(schedule)).to.emit(verdict, "Resolved");
      const scheduled = await hss.scheduleAt(schedule);
      expect(scheduled.executed).to.equal(true);
      expect(scheduled.deleted, "the delete from inside the run fails harmlessly").to.equal(false);
      await expect(hss.executeSchedule(schedule)).to.be.revertedWith("schedule finished");
      // The mock charges nothing for the run. On Hedera the network charges this contract, as the
      // schedule's payer, when the run executes; simulate that charge out of the balance now. Invariant
      // 1 holds because the reserve was still held, not swept, at the moment the charge could land.
      const charge = RESERVE / 2n;
      await setBalance(verdictAddress, (await ethers.provider.getBalance(verdictAddress)) - charge);
      await expectInvariants(ctx, [id]);
      await expect(verdict.connect(owner).sweepSurplus(bob.address)).to.changeEtherBalance(bob, RESERVE - charge);
      await expectInvariants(ctx, [id]);
    });
  });

  describe("stale feeds and voiding (brief items 6 and 7)", function () {
    it("a stale feed blocks resolve, defers the scheduled run, and voidMarket then fixes the payout at 0.5 HBAR", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hss, feed, alice, bob } = ctx;
      const { id, expiry, yes, no } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await verdict.connect(alice).split(id, alice.address, alice.address, { value: 4n * ONE_HBAR });
      await pushRound(feed, 2n, expiry - SIX_HOURS - 1n);
      await setTime(expiry);
      await expect(verdict.resolve(id)).to.be.revertedWithCustomError(verdict, "NoFreshReading").withArgs(id);
      await expect(hss.executeSchedule((await verdict.getMarket(id)).schedule))
        .to.emit(verdict, "ResolveDeferred")
        .withArgs(id, "no fresh reading");
      await expect(verdict.voidMarket(id))
        .to.be.revertedWithCustomError(verdict, "VoidTooEarly")
        .withArgs(id, expiry + DAY);
      await expect(verdict.connect(alice).redeem(id, 1n, 0n, alice.address)).to.be.revertedWithCustomError(
        verdict,
        "MarketNotSettled",
      );

      await setTime(expiry + DAY);
      await expect(verdict.connect(bob).voidMarket(id)).to.emit(verdict, "Voided").withArgs(id, bob.address);
      const m = await verdict.getMarket(id);
      expect(m.status).to.equal(Status.Void);
      expect(m.payout).to.equal(HALF);
      expect(m.reserve).to.equal(0n);
      expect(await verdict.pendingReserves()).to.equal(0n);
      await expectInvariants(ctx, [id]);

      await approveBoth(ctx, alice, yes, no, 4n * ONE_HBAR);
      await expect(verdict.connect(alice).redeem(id, 4n * ONE_HBAR, 0n, alice.address)).to.changeEtherBalances(
        [verdict, alice],
        [-(2n * ONE_HBAR), 2n * ONE_HBAR],
      );
      await expect(verdict.connect(alice).redeem(id, 0n, 4n * ONE_HBAR, alice.address)).to.changeEtherBalances(
        [verdict, alice],
        [-(2n * ONE_HBAR), 2n * ONE_HBAR],
      );
      expect((await verdict.getMarket(id)).collateral).to.equal(0n);
      await expect(verdict.voidMarket(id)).to.be.revertedWithCustomError(verdict, "MarketNotOpen");
      await expect(verdict.resolve(id)).to.be.revertedWithCustomError(verdict, "MarketNotOpen");
    });

    it("voidMarket reverts FreshReadingExists when a fresh reading exists, even 24 hours later", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await pushRound(feed, 2n, expiry - 1n);
      await setTime(expiry + DAY);
      await expect(verdict.voidMarket(id)).to.be.revertedWithCustomError(verdict, "FreshReadingExists").withArgs(id);
      await expect(verdict.resolve(id)).to.emit(verdict, "Resolved");
      await expect(verdict.voidMarket(99)).to.be.revertedWithCustomError(verdict, "NoSuchMarket");
    });
  });

  describe("redeem", function () {
    it("pays yes at the payout and no at the remainder, rounded down, to any address", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed, alice, carol } = ctx;
      const { id, expiry, yes, no } = await createMarket(ctx, { kind: Kind.Scalar, lower: 0n, upper: 3n });
      await verdict.connect(alice).split(id, alice.address, alice.address, { value: 10n });
      await pushRound(feed, 1n, expiry);
      await setTime(expiry);
      await verdict.resolve(id);
      expect((await verdict.getMarket(id)).payout).to.equal(33_333_333n);
      await approveBoth(ctx, alice, yes, no, 10n);
      // 7 YES at 0.33333333 is 2.33 tinybars, 5 NO at 0.66666667 is 3.33 tinybars: 2 + 3 paid.
      const tx = await verdict.connect(alice).redeem(id, 7n, 5n, carol.address);
      await expect(tx).to.emit(verdict, "Redeemed").withArgs(id, alice.address, 7n, 5n, 5n, carol.address);
      await expect(tx).to.changeEtherBalances([verdict, carol], [-5n, 5n]);
      expect(await yes.balanceOf(alice.address)).to.equal(3n);
      expect(await no.balanceOf(alice.address)).to.equal(5n);
      expect((await verdict.getMarket(id)).collateral).to.equal(5n);
      await expectInvariants(ctx, [id]);
    });

    it("rejects an open market, zero amounts, amounts beyond int64 and amounts worth more than the collateral", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed, alice, bob } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await verdict.connect(alice).split(id, alice.address, alice.address, { value: 10n });
      await expect(verdict.connect(alice).redeem(id, 1n, 0n, alice.address))
        .to.be.revertedWithCustomError(verdict, "MarketNotSettled")
        .withArgs(id);
      await pushRound(feed, 2n, expiry);
      await setTime(expiry);
      await verdict.resolve(id);
      await expect(verdict.connect(alice).redeem(id, 0n, 0n, alice.address)).to.be.revertedWithCustomError(
        verdict,
        "ZeroAmount",
      );
      await expect(verdict.connect(alice).redeem(id, INT64_MAX + 1n, 0n, alice.address)).to.be.revertedWithCustomError(
        verdict,
        "AmountTooLarge",
      );
      await expect(verdict.connect(bob).redeem(id, 11n, 0n, bob.address)).to.be.revertedWithCustomError(
        verdict,
        "AmountTooLarge",
      );
      await expect(verdict.connect(bob).redeem(99, 1n, 0n, bob.address)).to.be.revertedWithCustomError(
        verdict,
        "NoSuchMarket",
      );
    });
  });

  describe("HTS and HSS failures (brief items 8 and 9)", function () {
    it("an HTS failure during token creation surfaces as HtsError with the code", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hts, alice, resolver, feedId, creationCost } = ctx;
      await hts.setCreateFee(2n * ONE_HBAR);
      await expect(
        verdict
          .connect(alice)
          .createMarket(resolver, feedId, Kind.Above, 1n, 0n, (await now()) + HOUR, { value: creationCost }),
      )
        .to.be.revertedWithCustomError(verdict, "HtsError")
        .withArgs(CODE_INSUFFICIENT_TX_FEE);
      expect(await verdict.marketCount()).to.equal(0n);
      expect(await verdict.pendingReserves()).to.equal(0n);
    });

    it("a recipient without an association or a free automatic slot surfaces as NotAssociated(token)", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hts, alice, bob } = ctx;
      const { id, yes, no } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      const stranger = ethers.Wallet.createRandom().address;
      await expect(verdict.connect(alice).split(id, stranger, alice.address, { value: 1n }))
        .to.be.revertedWithCustomError(verdict, "NotAssociated")
        .withArgs(await yes.getAddress());
      await expect(verdict.connect(alice).split(id, alice.address, stranger, { value: 1n }))
        .to.be.revertedWithCustomError(verdict, "NotAssociated")
        .withArgs(await no.getAddress());
      // One free automatic slot lets the YES transfer through and the NO transfer then fails.
      await hts.setAutoAssociationSlots(stranger, 1n);
      await expect(verdict.connect(alice).split(id, stranger, stranger, { value: 1n }))
        .to.be.revertedWithCustomError(verdict, "NotAssociated")
        .withArgs(await no.getAddress());
      // Associating through the token's HIP-719 facade is what a wallet does, and then it works.
      await yes.connect(bob).associate();
      expect(await yes.connect(bob).isAssociated()).to.equal(true);
      await verdict.connect(alice).split(id, bob.address, alice.address, { value: 1n });
      expect(await yes.balanceOf(bob.address)).to.equal(1n);
    });

    it("missing or short allowances and short balances surface as HtsError with the HTS code", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, alice, bob } = ctx;
      const { id, yes, no } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await verdict.connect(alice).split(id, alice.address, alice.address, { value: 10n });
      await expect(verdict.connect(alice).merge(id, 5n, alice.address))
        .to.be.revertedWithCustomError(verdict, "HtsError")
        .withArgs(CODE_SPENDER_DOES_NOT_HAVE_ALLOWANCE);
      await approveBoth(ctx, alice, yes, no, 3n);
      await expect(verdict.connect(alice).merge(id, 5n, alice.address))
        .to.be.revertedWithCustomError(verdict, "HtsError")
        .withArgs(CODE_AMOUNT_EXCEEDS_ALLOWANCE);
      await approveBoth(ctx, bob, yes, no, 5n);
      await expect(verdict.connect(bob).merge(id, 5n, bob.address))
        .to.be.revertedWithCustomError(verdict, "HtsError")
        .withArgs(CODE_INSUFFICIENT_TOKEN_BALANCE);
    });

    it("only this contract can mint or burn: the HTS supply key check surfaces as a code", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { hts, alice } = ctx;
      const { yes } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      const [code] = await hts.connect(alice).mintToken.staticCall(await yes.getAddress(), 1n, []);
      expect(code).to.equal(CODE_INVALID_SIGNATURE);
    });

    it("an HSS failure does not block creation: ScheduleFailed carries the code and resolve still works", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hss, feed, alice, resolver, feedId, creationCost } = ctx;
      await hss.setForcedCode(CODE_SCHEDULE_TOO_FAR);
      const expiry = (await now()) + HOUR;
      await expect(
        verdict.connect(alice).createMarket(resolver, feedId, Kind.Above, 1n, 0n, expiry, { value: creationCost }),
      )
        .to.emit(verdict, "ScheduleFailed")
        .withArgs(0, CODE_SCHEDULE_TOO_FAR);
      const m = await verdict.getMarket(0);
      expect(m.schedule).to.equal(ethers.ZeroAddress);
      expect(m.reserve).to.equal(RESERVE);
      await pushRound(feed, 2n, expiry);
      await setTime(expiry);
      await expect(verdict.resolve(0)).to.emit(verdict, "Resolved");
    });

    it("a full expiry second makes createMarket schedule at the next free second", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hss, feed } = ctx;
      const expiry = (await now()) + HOUR;
      await hss.setBusy(expiry, true);
      await hss.setBusy(expiry + 1n, true);
      const { id } = await createMarket(ctx, { kind: Kind.Above, lower: 1n, expiry });
      const schedule = (await verdict.getMarket(id)).schedule;
      expect((await hss.scheduleAt(schedule)).expirySecond).to.equal(expiry + 2n);
      // The scheduled run happens two seconds late and still settles on the reading at expiry.
      await pushRound(feed, 7n, expiry - 1n);
      await pushRound(feed, 1n, expiry + 1n);
      await setTime(expiry + 2n);
      await expect(hss.executeSchedule(schedule))
        .to.emit(verdict, "Resolved")
        .withArgs(id, ONE_HBAR, 7n, anyValue, expiry - 1n, true);
    });

    it("when every probed second is full the schedule fails with the busy code and the market stays usable", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, hss } = ctx;
      const expiry = (await now()) + HOUR;
      for (let i = 0n; i <= 8n; i++) await hss.setBusy(expiry + i, true);
      await expect(
        verdict
          .connect(ctx.alice)
          .createMarket(ctx.resolver, ctx.feedId, Kind.Above, 1n, 0n, expiry, { value: ctx.creationCost }),
      )
        .to.emit(verdict, "ScheduleFailed")
        .withArgs(0, CODE_SCHEDULE_EXPIRY_BUSY);
      expect((await verdict.getMarket(0)).schedule).to.equal(ethers.ZeroAddress);
    });
  });

  describe("sweepSurplus (brief item 10)", function () {
    it("sweeps only what lies above collateral plus pending reserves, and reserves become sweepable at settlement", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed, owner, alice, bob } = ctx;
      const { id, expiry } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await verdict.connect(alice).split(id, alice.address, alice.address, { value: 3n * ONE_HBAR });
      await expect(verdict.connect(owner).sweepSurplus(bob.address)).to.be.revertedWithCustomError(
        verdict,
        "NothingToSweep",
      );
      await alice.sendTransaction({ to: await verdict.getAddress(), value: 2n * ONE_HBAR });
      const sweep = await verdict.connect(owner).sweepSurplus(bob.address);
      await expect(sweep)
        .to.emit(verdict, "SurplusSwept")
        .withArgs(bob.address, 2n * ONE_HBAR);
      await expect(sweep).to.changeEtherBalances([verdict, bob], [-(2n * ONE_HBAR), 2n * ONE_HBAR]);
      expect(await ethers.provider.getBalance(await verdict.getAddress())).to.equal(3n * ONE_HBAR + RESERVE);
      await expect(verdict.connect(owner).sweepSurplus(bob.address)).to.be.revertedWithCustomError(
        verdict,
        "NothingToSweep",
      );

      await pushRound(feed, 2n, expiry);
      await setTime(expiry);
      await verdict.resolve(id);
      await expect(verdict.connect(owner).sweepSurplus(bob.address)).to.changeEtherBalances(
        [verdict, bob],
        [-RESERVE, RESERVE],
      );
      expect(await ethers.provider.getBalance(await verdict.getAddress())).to.equal(3n * ONE_HBAR);
      await expectInvariants(ctx, [id]);
    });

    it("only the owner can sweep, and a recipient that rejects HBAR gives TransferFailed", async function () {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed, owner, alice } = ctx;
      await alice.sendTransaction({ to: await verdict.getAddress(), value: 1n });
      await expect(verdict.connect(alice).sweepSurplus(alice.address)).to.be.revertedWithCustomError(
        verdict,
        "OwnableUnauthorizedAccount",
      );
      const rejecting = await feed.getAddress();
      await expect(verdict.connect(owner).sweepSurplus(rejecting))
        .to.be.revertedWithCustomError(verdict, "TransferFailed")
        .withArgs(rejecting, 1n);
    });
  });

  describe("reentrancy (brief item 12)", function () {
    async function hostileMarket() {
      const ctx = await loadFixture(deployVerdict);
      const { verdict, alice } = ctx;
      const hostile = await (await ethers.getContractFactory("HostileRecipient")).deploy(verdict);
      const { id, expiry, yes, no } = await createMarket(ctx, { kind: Kind.Above, lower: 1n });
      await hostile.associate(await yes.getAddress());
      await hostile.associate(await no.getAddress());
      await verdict.connect(alice).split(id, hostile, hostile, { value: 1000n });
      await hostile.approve(await yes.getAddress(), 1000n);
      await hostile.approve(await no.getAddress(), 1000n);
      await alice.sendTransaction({ to: hostile, value: 10n });
      return { ctx, hostile, id, expiry, yes, no };
    }

    it("a recipient that re-enters merge from the payment fails, and the outer merge fails with TransferFailed", async function () {
      const { ctx, hostile, id } = await hostileMarket();
      await hostile.arm(1, id, false);
      await expect(hostile.callMerge(id, 500n))
        .to.be.revertedWithCustomError(ctx.verdict, "TransferFailed")
        .withArgs(await hostile.getAddress(), 500n);
      expect((await ctx.verdict.getMarket(id)).collateral).to.equal(1000n);
      await expectInvariants(ctx, [id]);
    });

    it("a recipient that swallows the failure is paid exactly once and the re-entry is recorded as blocked", async function () {
      const { ctx, hostile, id } = await hostileMarket();
      await hostile.arm(1, id, true);
      await expect(hostile.callMerge(id, 500n)).to.changeEtherBalances([ctx.verdict, hostile], [-500n, 500n]);
      expect(await hostile.reentryBlocked()).to.equal(true);
      expect(await hostile.reentered()).to.equal(false);
      expect((await ctx.verdict.getMarket(id)).collateral).to.equal(500n);
      await expectInvariants(ctx, [id]);
    });

    it("re-entering redeem or split from a redemption payment is blocked too", async function () {
      const { ctx, hostile, id, expiry } = await hostileMarket();
      await pushRound(ctx.feed, 2n, expiry);
      await setTime(expiry);
      await ctx.verdict.resolve(id);
      await hostile.arm(2, id, true);
      await expect(hostile.callRedeem(id, 100n, 0n)).to.changeEtherBalances([ctx.verdict, hostile], [-100n, 100n]);
      expect(await hostile.reentryBlocked()).to.equal(true);
      await hostile.arm(3, id, false);
      await expect(hostile.callRedeem(id, 100n, 0n)).to.be.revertedWithCustomError(ctx.verdict, "TransferFailed");
      expect((await ctx.verdict.getMarket(id)).collateral).to.equal(900n);
      await expectInvariants(ctx, [id]);
    });
  });

  describe("redemption rounding (brief item 13)", function () {
    // A small deterministic generator so the sequence is the same on every run.
    function lcg(seed: bigint) {
      let state = seed;
      return (max: bigint): bigint => {
        state = (state * 6364136223846793005n + 1442695040888963407n) % (1n << 64n);
        return (state >> 11n) % max;
      };
    }

    it("never pays out more than the collateral across random amounts and payouts, keeping invariant 3", async function () {
      this.timeout(300_000);
      const ctx = await loadFixture(deployVerdict);
      const { verdict, feed, alice, bob } = ctx;
      const random = lcg(20261002n);
      const ids: bigint[] = [];
      for (let round = 0; round < 4; round++) {
        const lower = 0n;
        const upper = 1_000_000n + random(1_000_000n);
        const { id, expiry, yes, no } = await createMarket(ctx, { kind: Kind.Scalar, lower, upper });
        ids.push(id);
        const aliceStake = 1n + random(5_000_000n);
        const bobStake = 1n + random(5_000_000n);
        await verdict.connect(alice).split(id, alice.address, alice.address, { value: aliceStake });
        await verdict.connect(bob).split(id, bob.address, bob.address, { value: bobStake });
        // Move some YES across so holdings are uneven.
        const moved = random(aliceStake);
        if (moved > 0n) await yes.connect(alice).transfer(bob.address, moved);

        await pushRound(feed, random(upper + 1n), expiry);
        await setTime(expiry);
        await verdict.resolve(id);
        const collateralBefore = (await verdict.getMarket(id)).collateral;
        expect(collateralBefore).to.equal(aliceStake + bobStake);
        await expectInvariants(ctx, ids);

        let paidTotal = 0n;
        for (const holder of [alice, bob]) {
          await approveBoth(ctx, holder, yes, no, ethers.MaxUint256);
          for (let step = 0; step < 2; step++) {
            const yesHeld = await yes.balanceOf(holder.address);
            const noHeld = await no.balanceOf(holder.address);
            const yesAmount = step === 1 ? yesHeld : random(yesHeld + 1n);
            const noAmount = step === 1 ? noHeld : random(noHeld + 1n);
            if (yesAmount === 0n && noAmount === 0n) continue;
            const before = await ethers.provider.getBalance(await verdict.getAddress());
            await verdict.connect(holder).redeem(id, yesAmount, noAmount, holder.address);
            paidTotal += before - (await ethers.provider.getBalance(await verdict.getAddress()));
          }
          await expectInvariants(ctx, ids);
        }
        expect(paidTotal).to.be.lte(collateralBefore);
        expect(await yes.totalSupply()).to.equal(0n);
        expect(await no.totalSupply()).to.equal(0n);
        // What rounding left behind stays as this market's collateral; it is never larger than the
        // number of redemptions, and it can only be swept because invariant 1 still holds.
        expect((await verdict.getMarket(id)).collateral).to.equal(collateralBefore - paidTotal);
      }
      await expectInvariants(ctx, ids);
    });
  });
});
