// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CampaignV4} from "../src/CampaignV4.sol";
import {CampaignParams} from "../src/CampaignV3.sol";
import {CampaignFactoryV6} from "../src/CampaignFactoryV6.sol";
import {FeeSplitterV4} from "../src/FeeSplitterV4.sol";
import {LegDeployerV3} from "../src/LegDeployerV3.sol";
import {SplitterDeployerV4} from "../src/SplitterDeployerV4.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";
import {MockERC20, MockPonsFactory, MockLaunchAndBuy} from "./CampaignV3.t.sol";

/// "Locking pre-launch would be badass, it would just have to read as
/// locked." The lock is the campaign contract itself: claimTokens()
/// refuses before the date, and nobody can change the date but the
/// backer, and only to make it longer.
contract PreLaunchLockTest is Test {
    CampaignFactoryV6 cf;
    MockPonsFactory ponsF;
    MockLaunchAndBuy lab;
    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    uint256 constant FEE = 0.001 ether;

    function setUp() public {
        ponsF = new MockPonsFactory();
        lab = new MockLaunchAndBuy();
        cf = new CampaignFactoryV6(
            address(0xFEE), address(0x4EAA), 700, 300,
            IPonsV2Factory(address(ponsF)), IPonsV2LaunchAndBuy(address(lab)), address(0xE5C60),
            IPoolManagerMin(address(0xB0)), address(0xB1), IV4StateView(address(0xB2)),
            new LegDeployerV3(), FEE, IERC20(address(0)), 0, address(0), address(new SplitterDeployerV4())
        );
        vm.deal(creator, 20 ether); vm.deal(alice, 20 ether); vm.deal(bob, 20 ether);
    }

    function _create(uint256 goal) internal returns (CampaignV4 c) {
        CampaignParams memory p;
        p.goal = goal; p.minDeposit = 0.1 ether; p.deadline = block.timestamp + 1 days;
        p.meta = PonsTokenMeta("LK", "LK", "", "t", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
        vm.prank(creator);
        c = cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(7)));
    }

    function test_lockedSeat_tokensStayUntilDate_thenClaim() public {
        CampaignV4 c = _create(1 ether);
        vm.prank(alice); c.depositLocked{value: 0.6 ether}(365);
        vm.prank(bob); c.deposit{value: 0.4 ether}();
        assertEq(c.lockDays(alice), 365, "readable by anyone, before launch");
        assertEq(c.lockUntil(alice), 0, "no date until launch - measured from launch");
        assertEq(c.lockDays(bob), 0);
        vm.warp(block.timestamp + 12 hours); // the raise takes a while
        vm.prank(creator); c.launch();
        uint64 until = uint64(block.timestamp + 365 days);
        assertEq(c.lockUntil(alice), until, "a full year from LAUNCH");
        // bob is free; alice is not
        vm.prank(bob); c.claimTokens();
        vm.expectRevert(CampaignV4.StillLocked.selector);
        vm.prank(alice); c.claimTokens();
        vm.warp(until - 1);
        vm.expectRevert(CampaignV4.StillLocked.selector);
        vm.prank(alice); c.claimTokens();
        vm.warp(until);
        vm.prank(alice); c.claimTokens();
        assertEq(MockERC20(c.token()).balanceOf(alice), 600_000 ether, "tokens are NOT weighted - same allocation as an unlocked 0.6");
    }

    // ── locking pays ─────────────────────────────────────────────────

    function test_lockWeights_aYearEarnsOneAndAHalf() public {
        CampaignV4 c = _create(1 ether);
        vm.prank(alice); c.depositLocked{value: 0.5 ether}(365); // weight 0.75
        vm.prank(bob); c.deposit{value: 0.5 ether}();             // weight 0.5
        assertEq(c.weightedRaised(), 1.25 ether);
        vm.prank(creator); c.launch();
        assertEq(c.weightedRaisedAtLaunch(), 1.25 ether);
        FeeSplitterV4 sp = c.feeSplitter();
        (bool ok, ) = address(sp).call{value: 1 ether}(""); require(ok); // 0.9 to backers
        sp.distribute(address(0));
        assertEq(sp.backerEntitlement(alice, address(0)), (uint256(0.9 ether) * 3) / 5, "0.75 / 1.25 of the pool");
        assertEq(sp.backerEntitlement(bob, address(0)), (uint256(0.9 ether) * 2) / 5);
        vm.prank(alice); assertEq(sp.claimBacker(address(0)), 0.54 ether);
        vm.prank(bob); assertEq(sp.claimBacker(address(0)), 0.36 ether);
        assertEq(address(sp).balance, 0.1 ether, "legs 10% untouched - the bonus came from the pool");
    }

    function test_lockWeights_tiers_andExtendReweights() public {
        CampaignV4 c = _create(1 ether);
        assertEq(c.lockMultiplierBps(0), 10_000);
        assertEq(c.lockMultiplierBps(179), 10_000);
        assertEq(c.lockMultiplierBps(180), 12_500);
        assertEq(c.lockMultiplierBps(364), 12_500);
        assertEq(c.lockMultiplierBps(365), 15_000);
        assertEq(c.lockMultiplierBps(1460), 15_000, "no tier above 1.5x");
        vm.prank(alice); c.deposit{value: 0.4 ether}();
        assertEq(c.weightedRaised(), 0.4 ether);
        vm.prank(alice); c.extendLock(180);
        assertEq(c.weightedRaised(), 0.5 ether, "existing stake re-weighted at 1.25");
        vm.prank(alice); c.deposit{value: 0.2 ether}(); // top-up at the seat's multiplier
        assertEq(c.weightedRaised(), 0.75 ether);
        vm.prank(alice); c.extendLock(365);
        assertEq(c.weightedRaised(), 0.9 ether);
        vm.prank(alice); c.withdraw();
        assertEq(c.weightedRaised(), 0);
        assertEq(c.lockDays(alice), 0);
    }

    function test_lockWeights_frozenAtLaunch_noPostLaunchExtend() public {
        CampaignV4 c = _create(1 ether);
        vm.prank(alice); c.deposit{value: 0.6 ether}();
        vm.prank(bob); c.deposit{value: 0.4 ether}();
        vm.prank(creator); c.launch();
        vm.expectRevert(CampaignV4.BadState.selector);
        vm.prank(alice); c.extendLock(365);
        assertEq(c.weightedRaisedAtLaunch(), 1 ether);
    }

    function test_lockedSeat_stillEarnsFullFees() public {
        CampaignV4 c = _create(1 ether);
        vm.prank(alice); c.depositLocked{value: 0.6 ether}(365); // weight 0.9 vs bob 0.4
        vm.prank(bob); c.deposit{value: 0.4 ether}();
        vm.prank(creator); c.launch();
        FeeSplitterV4 sp = c.feeSplitter();
        (bool ok, ) = address(sp).call{value: 1 ether}(""); require(ok);
        assertEq(sp.heldBps(alice), 10_000, "locked = held");
        vm.prank(alice); uint256 paid = sp.claimBacker(address(0));
        assertEq(paid, (uint256(0.9 ether) * 9) / 13, "her weighted share: 0.9 / 1.3 of the 0.9 pool");
    }

    function test_lock_onlyEverLonger_andCapped() public {
        CampaignV4 c = _create(1 ether);
        vm.prank(alice); c.depositLocked{value: 0.6 ether}(180);
        // shorter: no
        vm.expectRevert(CampaignV4.LockNotLonger.selector);
        vm.prank(alice); c.extendLock(90);
        // same: no
        vm.expectRevert(CampaignV4.LockNotLonger.selector);
        vm.prank(alice); c.extendLock(180);
        // zero: no
        vm.expectRevert(CampaignV4.LockNotLonger.selector);
        vm.prank(bob); c.depositLocked{value: 0.4 ether}(0);
        // too long: no (fat-finger guard)
        vm.expectRevert(CampaignV4.LockTooLong.selector);
        vm.prank(alice); c.extendLock(5 * 365);
        // longer: yes
        vm.prank(alice); c.extendLock(365);
        assertEq(c.lockDays(alice), 365);
        // a plain top-up deposit keeps the lock
        vm.prank(alice); c.deposit{value: 0.1 ether}();
        assertEq(c.lockDays(alice), 365);
    }

    function test_withdrawBeforeLaunch_clearsTheLock() public {
        CampaignV4 c = _create(1 ether);
        vm.prank(alice); c.depositLocked{value: 0.6 ether}(365);
        vm.prank(alice); c.withdraw();
        assertEq(c.lockDays(alice), 0, "no seat, no promise");
        // and re-entering unlocked is fine — the lock was never a trap
        vm.prank(alice); c.deposit{value: 0.6 ether}();
        assertEq(c.lockDays(alice), 0);
    }

    function test_lockNeverTrapsTheExcessRefund() public {
        // 6 ETH raise against the mock's 4.2 ETH curve cap → 1.8 excess
        CampaignV4 c = _create(6 ether);
        vm.prank(alice); c.depositLocked{value: 3 ether}(365);
        vm.prank(bob); c.deposit{value: 3 ether}();
        vm.prank(creator); c.launch();
        // pons' launch fee comes off the pooled buy first: 6 − 0.0005 − 4.2
        uint256 excess = c.excessAtLaunch();
        assertEq(excess, 6 ether - ponsF.launchFee() - 4.2 ether);
        uint256 before = alice.balance;
        vm.prank(alice); c.claimExcess();
        assertEq(alice.balance - before, excess / 2, "her half of the excess, while still locked");
        vm.expectRevert(CampaignV4.BadAmount.selector);
        vm.prank(alice); c.claimExcess(); // once
        // tokens still locked; after the date, claimTokens pays tokens only
        vm.warp(c.lockUntil(alice));
        before = alice.balance;
        vm.prank(alice); c.claimTokens();
        assertEq(alice.balance, before, "no double excess");
        assertEq(MockERC20(c.token()).balanceOf(alice), 500_000 ether);
        // bob, unlocked, gets both in one go as before
        before = bob.balance;
        vm.prank(bob); c.claimTokens();
        assertEq(bob.balance - before, excess / 2);
    }

    function test_extendLock_needsASeat() public {
        CampaignV4 c = _create(1 ether);
        vm.expectRevert(CampaignV4.BadState.selector);
        vm.prank(alice); c.extendLock(30);
        vm.prank(alice); c.deposit{value: 0.6 ether}();
        vm.prank(alice); c.extendLock(30);
        assertEq(c.lockDays(alice), 30);
        assertEq(c.lockMultiplierBps(30), 10_000, "short locks are a signal, not a bonus");
    }

    // ── creator edits before launch ──────────────────────────────────

    function test_updateMeta_creatorOnly_preLaunchOnly() public {
        CampaignV4 c = _create(1 ether);
        PonsTokenMeta memory m = PonsTokenMeta("Renamed", "RNM", "ipfs://logo", "new pitch", PonsSocials("https://x.com/rnm", "", "", "https://rnm.xyz", ""), address(0));
        vm.expectRevert(CampaignV4.OnlyCreator.selector);
        vm.prank(alice); c.updateMeta(m);
        vm.prank(creator); c.updateMeta(m);
        PonsTokenMeta memory got = c.tokenMeta();
        assertEq(got.name, "Renamed"); assertEq(got.symbol, "RNM"); assertEq(got.socials.website, "https://rnm.xyz");
        // empty identity is refused
        m.name = "";
        vm.expectRevert(CampaignV4.BadAmount.selector);
        vm.prank(creator); c.updateMeta(m);
        // launched → frozen forever
        m.name = "Again";
        vm.prank(alice); c.deposit{value: 1 ether}();
        vm.prank(creator); c.launch();
        vm.expectRevert(CampaignV4.BadState.selector);
        vm.prank(creator); c.updateMeta(m);
        assertEq(c.tokenMeta().name, "Renamed", "what launched is what stays");
    }

    function test_teamMaxDeposit_teamSeatsCanTakeMore() public {
        CampaignParams memory p;
        p.goal = 1 ether; p.minDeposit = 0.1 ether; p.maxDeposit = 0.2 ether; p.maxBackers = 4; p.reservedSeats = 1;
        p.deadline = block.timestamp + 1 days;
        p.meta = PonsTokenMeta("TM", "TM", "", "t", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](1); p.allowlist[0] = bob;
        vm.prank(creator);
        CampaignV4 c = cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(8)));
        // no team cap set: team seat uses the public cap
        vm.expectRevert(CampaignV4.BadAmount.selector);
        vm.prank(bob); c.deposit{value: 0.5 ether}();
        // creator sets a team cap; public cap unchanged
        vm.expectRevert(CampaignV4.OnlyCreator.selector);
        vm.prank(alice); c.setTeamMaxDeposit(0.5 ether);
        vm.prank(creator); c.setTeamMaxDeposit(0.5 ether);
        vm.prank(bob); c.deposit{value: 0.5 ether}();       // team seat, 0.5 ok
        vm.expectRevert(CampaignV4.BadAmount.selector);
        vm.prank(alice); c.deposit{value: 0.5 ether}();     // public seat still capped at 0.2
        vm.prank(alice); c.deposit{value: 0.2 ether}();
        assertEq(c.seatBucket(bob), 2); assertEq(c.seatBucket(alice), 1);
        // below min or after launch: refused
        vm.expectRevert(CampaignV4.BadAmount.selector);
        vm.prank(creator); c.setTeamMaxDeposit(0.05 ether);
    }

    function test_teamMaxDeposit_needsTeamSeats() public {
        CampaignV4 c = _create(1 ether); // no reserved seats
        vm.expectRevert(CampaignV4.BadAmount.selector);
        vm.prank(creator); c.setTeamMaxDeposit(0.5 ether);
    }
}
