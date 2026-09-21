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

/// "Backers who sell stop receiving fee share" — the founder's question,
/// 2026-09-21. Every test is one sentence of the rule in FeeSplitterV4.
contract HoldWeightedTest is Test {
    CampaignFactoryV6 cf;
    MockPonsFactory ponsF;
    MockLaunchAndBuy lab;
    CampaignV4 c;
    FeeSplitterV4 sp;
    MockERC20 tok;

    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);   // 0.6 of a 1 ETH raise
    address bob = address(0xB0B);       // 0.4
    address carol = address(0xCA401);   // stranger / cranker
    address constant PLATFORM = address(0xFEE);
    address constant REWARDS = address(0x4EAA);
    address constant ETH = address(0);
    uint256 constant FEE = 0.001 ether;

    function setUp() public {
        ponsF = new MockPonsFactory();
        lab = new MockLaunchAndBuy();
        cf = new CampaignFactoryV6(
            PLATFORM, REWARDS, 700, 300,
            IPonsV2Factory(address(ponsF)), IPonsV2LaunchAndBuy(address(lab)), address(0xE5C60),
            IPoolManagerMin(address(0xB0)), address(0xB1), IV4StateView(address(0xB2)),
            new LegDeployerV3(), FEE, IERC20(address(0)), 0, address(0), address(new SplitterDeployerV4())
        );
        vm.deal(creator, 20 ether); vm.deal(alice, 20 ether); vm.deal(bob, 20 ether); vm.deal(carol, 20 ether);

        CampaignParams memory p;
        p.goal = 1 ether; p.minDeposit = 0.1 ether; p.deadline = block.timestamp + 1 days;
        p.meta = PonsTokenMeta("HW", "HW", "", "t", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
        vm.prank(creator);
        c = cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(1)));
        sp = c.feeSplitter();

        vm.prank(alice); c.deposit{value: 0.6 ether}();
        vm.prank(bob); c.deposit{value: 0.4 ether}();
        vm.prank(creator); c.launch();
        tok = MockERC20(c.token());
        assertEq(c.tokensAtLaunch(), 1_000_000 ether);
    }

    function _fees(uint256 amt) internal {
        (bool ok, ) = address(sp).call{value: amt}("");
        require(ok);
        sp.distribute(ETH); // views read the accounted pool, as the UI's collect step does
    }
    function _claimTokens(address who) internal { vm.prank(who); c.claimTokens(); }
    function _dump(address who, uint256 amt) internal { vm.prank(who); tok.transfer(address(0xDEAD), amt); }

    // ── the rule ─────────────────────────────────────────────────────

    function test_wiring_forfeitToIsHolderRewardsLeg() public view {
        assertEq(sp.forfeitTo(), REWARDS);
        assertEq(sp.legRecipients(0), REWARDS);
        assertEq(sp.backerBps(), 9000);
    }

    function test_fullHolder_paidInFull() public {
        _claimTokens(alice);
        _fees(1 ether); // 0.9 to backers: alice 0.54, bob 0.36
        assertEq(sp.heldBps(alice), 10_000);
        uint256 before = alice.balance;
        vm.prank(alice); uint256 paid = sp.claimBacker(ETH);
        assertEq(paid, 0.54 ether);
        assertEq(alice.balance - before, 0.54 ether);
        assertEq(sp.legOwed(REWARDS, ETH), 0.03 ether, "rewards leg untouched by a holder");
    }

    function test_fullSeller_forfeitsEverythingToStakers() public {
        _claimTokens(bob);
        _dump(bob, 400_000 ether);
        _fees(1 ether);
        assertEq(sp.heldBps(bob), 0);
        assertEq(sp.backerOwed(bob, ETH), 0);
        uint256 before = bob.balance;
        vm.prank(bob); uint256 paid = sp.claimBacker(ETH); // does not revert: judged + recorded
        assertEq(paid, 0);
        assertEq(bob.balance, before);
        assertEq(sp.legOwed(REWARDS, ETH), 0.03 ether + 0.36 ether, "bob's whole share moved to the rewards leg");
        // and the leg can actually pull it
        uint256 rb = REWARDS.balance;
        vm.prank(REWARDS); sp.claimLeg(ETH);
        assertEq(REWARDS.balance - rb, 0.39 ether);
        // second claim: nothing fresh, nothing banked
        vm.expectRevert(FeeSplitterV4.NothingToClaim.selector);
        vm.prank(bob); sp.claimBacker(ETH);
    }

    function test_halfSeller_earnsHalf() public {
        _claimTokens(bob);
        _dump(bob, 200_000 ether);
        _fees(1 ether);
        assertEq(sp.heldBps(bob), 5_000);
        assertEq(sp.backerOwed(bob, ETH), 0.18 ether);
        vm.prank(bob); uint256 paid = sp.claimBacker(ETH);
        assertEq(paid, 0.18 ether);
        assertEq(sp.legOwed(REWARDS, ETH), 0.03 ether + 0.18 ether);
    }

    function test_settleCrank_locksForfeitureWhileOut_buyBackDoesNotRecover() public {
        _claimTokens(bob);
        _dump(bob, 400_000 ether);
        _fees(1 ether);                       // 0.36 accrues to bob while he is OUT
        vm.prank(carol); sp.settle(bob, ETH); // anyone can lock it in
        assertEq(sp.legOwed(REWARDS, ETH), 0.39 ether);
        assertEq(sp.backerBanked(bob, ETH), 0);
        // bob buys back his whole allocation…
        tok.mint(bob, 400_000 ether);
        assertEq(sp.heldBps(bob), 10_000);
        // …and only NEW fees pay him
        _fees(1 ether);
        assertEq(sp.backerOwed(bob, ETH), 0.36 ether, "the fees from while he was out are gone");
        vm.prank(bob); uint256 paid = sp.claimBacker(ETH);
        assertEq(paid, 0.36 ether);
    }

    function test_withoutCrank_buyBackBeforeClaim_isTheKnownEdge() public {
        // Stated in the contract header: if nobody settles a seller, fresh
        // entitlement is judged at claim time. This test pins the edge so a
        // future change to it is deliberate.
        _claimTokens(bob);
        _dump(bob, 400_000 ether);
        _fees(1 ether);
        tok.mint(bob, 400_000 ether); // buys back before anyone cranks
        vm.prank(bob); uint256 paid = sp.claimBacker(ETH);
        assertEq(paid, 0.36 ether);
    }

    function test_bankedWhileHolding_survivesLaterSale() public {
        _claimTokens(alice);
        _fees(1 ether);
        vm.prank(carol); sp.settle(alice, ETH); // judged at 100% → banked
        assertEq(sp.backerBanked(alice, ETH), 0.54 ether);
        _dump(alice, 600_000 ether);            // sells everything AFTER
        assertEq(sp.heldBps(alice), 0);
        assertEq(sp.backerOwed(alice, ETH), 0.54 ether, "earned while in - still hers");
        vm.prank(alice); uint256 paid = sp.claimBacker(ETH);
        assertEq(paid, 0.54 ether);
        // fees from now on are forfeited
        _fees(1 ether);
        vm.prank(alice); paid = sp.claimBacker(ETH);
        assertEq(paid, 0);
        assertEq(sp.legOwed(REWARDS, ETH), 0.06 ether + 0.54 ether);
    }

    function test_unclaimedTokens_countAsHeld() public {
        // bob never calls claimTokens — his allocation sits in the campaign
        _fees(1 ether);
        assertEq(sp.heldBps(bob), 10_000);
        vm.prank(bob); uint256 paid = sp.claimBacker(ETH);
        assertEq(paid, 0.36 ether);
    }

    function test_overAllocation_capsAtFullShare() public {
        _claimTokens(alice); _claimTokens(bob);
        vm.prank(bob); tok.transfer(alice, 100_000 ether); // alice now holds 700k vs 600k allotted
        _fees(1 ether);
        assertEq(sp.heldBps(alice), 10_000);
        vm.prank(alice); uint256 paid = sp.claimBacker(ETH);
        assertEq(paid, 0.54 ether, "never more than the launch-time share");
        assertEq(sp.heldBps(bob), 7_500);
    }

    function test_neverScaledTwice_settleThenClaim() public {
        _claimTokens(bob);
        _dump(bob, 200_000 ether); // 50%
        _fees(1 ether);
        vm.prank(carol); sp.settle(bob, ETH);   // 0.18 banked, 0.18 forfeited
        vm.prank(bob); uint256 paid = sp.claimBacker(ETH);
        assertEq(paid, 0.18 ether, "banked is paid as-is, not halved again");
        assertEq(sp.legOwed(REWARDS, ETH), 0.21 ether);
    }

    function test_accounting_everyWeiIsOwedToSomeone() public {
        _claimTokens(alice); _claimTokens(bob);
        _dump(bob, 300_000 ether); // bob holds 25%
        _fees(1.234567 ether);
        vm.prank(carol); sp.settle(bob, ETH);
        vm.prank(alice); sp.claimBacker(ETH);
        _fees(0.5 ether);
        // judge everyone: unjudged entitlement is owed to backer-or-stakers,
        // and only settle() decides which
        vm.prank(carol); sp.settle(alice, ETH);
        vm.prank(carol); sp.settle(bob, ETH);
        uint256 owedAll = sp.legOwed(REWARDS, ETH) + sp.legOwed(PLATFORM, ETH)
            + sp.backerOwed(alice, ETH) + sp.backerOwed(bob, ETH);
        assertEq(address(sp).balance, sp.accounted(ETH));
        // rounding dust from integer bps math can leave a few wei in the
        // pool that nobody can name — never more than a handful
        assertLe(address(sp).balance - owedAll, 10);
    }

    function test_claimAs_withoutRouter_reverts_andStrangerCannotClaim() public {
        _fees(1 ether);
        vm.expectRevert(FeeSplitterV4.NothingToClaim.selector);
        vm.prank(carol); sp.claimBacker(ETH);
    }

    function test_preLaunch_settleAndClaim_revert() public {
        // a fresh campaign that has not launched
        CampaignParams memory p;
        p.goal = 1 ether; p.minDeposit = 0.1 ether; p.deadline = block.timestamp + 1 days;
        p.meta = PonsTokenMeta("HW2", "HW2", "", "t", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
        vm.prank(creator);
        CampaignV4 c2 = cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(2)));
        FeeSplitterV4 sp2 = c2.feeSplitter();
        vm.expectRevert(FeeSplitterV4.NotLaunched.selector);
        vm.prank(carol); sp2.settle(alice, ETH);
        vm.expectRevert(FeeSplitterV4.NotLaunched.selector);
        vm.prank(alice); sp2.claimBacker(ETH);
    }

    /// The browser grinder reads previewInitCodeHash and grinds against
    /// it. v8 must encode exactly like v7 (only the creation code differs).
    function test_v8_vanityMirror() public view {
        CampaignParams memory p;
        p.goal = 1 ether; p.minDeposit = 0.1 ether; p.deadline = block.timestamp + 1 days;
        p.meta = PonsTokenMeta("SEED", "SEED", "", "v", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
        address[] memory legs = new address[](2); uint16[] memory bps = new uint16[](2);
        legs[0] = REWARDS; bps[0] = 300; legs[1] = PLATFORM; bps[1] = 700;
        bytes32 expected = keccak256(abi.encodePacked(
            type(CampaignV4).creationCode,
            abi.encode(creator, IPonsV2Factory(address(ponsF)), IPonsV2LaunchAndBuy(address(lab)), address(0xE5C60),
                address(cf.equityRouter()), cf.splitterDeployer(), p, uint16(9000), legs, bps)
        ));
        assertEq(cf.previewInitCodeHash(creator, p, 0, 0, new address[](0), new uint16[](0), address(0), address(0)), expected);
    }
}
