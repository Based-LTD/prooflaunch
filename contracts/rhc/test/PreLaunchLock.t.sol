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
        uint64 until = uint64(block.timestamp + 365 days);
        vm.prank(alice); c.depositLocked{value: 0.6 ether}(until);
        vm.prank(bob); c.deposit{value: 0.4 ether}();
        assertEq(c.lockUntil(alice), until, "readable by anyone, before launch");
        assertEq(c.lockUntil(bob), 0);
        vm.prank(creator); c.launch();
        // bob is free; alice is not
        vm.prank(bob); c.claimTokens();
        vm.expectRevert(CampaignV4.StillLocked.selector);
        vm.prank(alice); c.claimTokens();
        // the day comes
        vm.warp(until);
        vm.prank(alice); c.claimTokens();
        assertEq(MockERC20(c.token()).balanceOf(alice), 600_000 ether);
    }

    function test_lockedSeat_stillEarnsFullFees() public {
        CampaignV4 c = _create(1 ether);
        vm.prank(alice); c.depositLocked{value: 0.6 ether}(uint64(block.timestamp + 365 days));
        vm.prank(bob); c.deposit{value: 0.4 ether}();
        vm.prank(creator); c.launch();
        FeeSplitterV4 sp = c.feeSplitter();
        (bool ok, ) = address(sp).call{value: 1 ether}(""); require(ok);
        assertEq(sp.heldBps(alice), 10_000, "locked = held");
        vm.prank(alice); uint256 paid = sp.claimBacker(address(0));
        assertEq(paid, 0.54 ether);
    }

    function test_lock_onlyEverLonger_andCapped() public {
        CampaignV4 c = _create(1 ether);
        uint64 until = uint64(block.timestamp + 180 days);
        vm.prank(alice); c.depositLocked{value: 0.6 ether}(until);
        // shorter: no
        vm.expectRevert(CampaignV4.LockNotLonger.selector);
        vm.prank(alice); c.extendLock(uint64(block.timestamp + 90 days));
        // same: no
        vm.expectRevert(CampaignV4.LockNotLonger.selector);
        vm.prank(alice); c.extendLock(until);
        // past: no
        vm.expectRevert(CampaignV4.LockNotLonger.selector);
        vm.prank(bob); c.depositLocked{value: 0.4 ether}(uint64(block.timestamp - 1));
        // too long: no (fat-finger guard)
        vm.expectRevert(CampaignV4.LockTooLong.selector);
        vm.prank(alice); c.extendLock(uint64(block.timestamp + 5 * 365 days));
        // longer: yes
        vm.prank(alice); c.extendLock(uint64(block.timestamp + 365 days));
        assertEq(c.lockUntil(alice), block.timestamp + 365 days);
        // a plain top-up deposit keeps the lock
        vm.prank(alice); c.deposit{value: 0.1 ether}();
        assertEq(c.lockUntil(alice), block.timestamp + 365 days);
    }

    function test_withdrawBeforeLaunch_clearsTheLock() public {
        CampaignV4 c = _create(1 ether);
        vm.prank(alice); c.depositLocked{value: 0.6 ether}(uint64(block.timestamp + 365 days));
        vm.prank(alice); c.withdraw();
        assertEq(c.lockUntil(alice), 0, "no seat, no promise");
        // and re-entering unlocked is fine — the lock was never a trap
        vm.prank(alice); c.deposit{value: 0.6 ether}();
        assertEq(c.lockUntil(alice), 0);
    }

    function test_lockNeverTrapsTheExcessRefund() public {
        // 6 ETH raise against the mock's 4.2 ETH curve cap → 1.8 excess
        CampaignV4 c = _create(6 ether);
        vm.prank(alice); c.depositLocked{value: 3 ether}(uint64(block.timestamp + 365 days));
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
        vm.warp(block.timestamp + 365 days);
        before = alice.balance;
        vm.prank(alice); c.claimTokens();
        assertEq(alice.balance, before, "no double excess");
        assertEq(MockERC20(c.token()).balanceOf(alice), 500_000 ether);
        // bob, unlocked, gets both in one go as before
        before = bob.balance;
        vm.prank(bob); c.claimTokens();
        assertEq(bob.balance - before, excess / 2);
    }

    function test_extendLock_needsASeat_andNotAfterClaim() public {
        CampaignV4 c = _create(1 ether);
        vm.expectRevert(CampaignV4.BadState.selector);
        vm.prank(alice); c.extendLock(uint64(block.timestamp + 30 days));
        vm.prank(alice); c.deposit{value: 0.6 ether}();
        vm.prank(bob); c.deposit{value: 0.4 ether}();
        vm.prank(creator); c.launch();
        // can still lock AFTER launch, before claiming — a public commitment any time
        vm.prank(alice); c.extendLock(uint64(block.timestamp + 30 days));
        vm.expectRevert(CampaignV4.StillLocked.selector);
        vm.prank(alice); c.claimTokens();
        vm.warp(block.timestamp + 30 days);
        vm.prank(alice); c.claimTokens();
        vm.expectRevert(CampaignV4.BadState.selector);
        vm.prank(alice); c.extendLock(uint64(block.timestamp + 30 days));
    }
}
