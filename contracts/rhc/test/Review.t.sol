// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CampaignV3, CampaignParams} from "../src/CampaignV3.sol";
import {CampaignFactoryV5} from "../src/CampaignFactoryV5.sol";
import {LegDeployerV3} from "../src/LegDeployerV3.sol";
import {BurnLegV3} from "../src/BurnLegV3.sol";
import {FeedLPLegV3} from "../src/FeedLPLegV3.sol";
import {RewardsVault, IERC20Pull, IEquityRouter, ISplitterLegPull} from "../src/RewardsVault.sol";
import {ICampaignV2View, IFeeSplitterLegV2, IPonsV2FactoryLegView} from "../src/V4LegBase.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";
import {MockERC20, MockLaunchAndBuy} from "./CampaignV3.t.sol";

/// Adversarial review, 2026-09-19. Every test here is one review finding:
/// it fails against the pre-fix code and passes against the fix. The
/// findings doc (docs/rhc-review-findings.md) cites these by name.

contract MockPonsFactoryMut {
    uint256 public launchFee = 0.0005 ether;
    function setLaunchFee(uint256 f) external { launchFee = f; }
    function maxCreatorTaxBps() external pure returns (uint256) { return 1000; }
    function previewLaunchEconomics(uint256, address) external pure returns (bytes32) { return bytes32(uint256(42)); }
}

// ── minimal world for a bot leg on a curve that hasn't graduated ──
contract MockCurve {
    MockERC20 public tok;
    constructor(MockERC20 t) { tok = t; }
    function graduated() external pure returns (bool) { return false; }
    function buy(uint256 quoteIn, uint256, address recipient) external payable returns (uint256) {
        tok.mint(recipient, quoteIn * 1000);
        return quoteIn * 1000;
    }
}
contract MockCampaignView {
    address public token; address public curve; bool public launched = true;
    constructor(address t, address c) { token = t; curve = c; }
}
contract MockSplitter { function claimLeg(address) external {} }

contract TickProbe is FeedLPLegV3 {
    constructor() FeedLPLegV3(address(this), IPoolManagerMin(address(1)), address(2), IV4StateView(address(3))) {}
    function maxTick(int24 s) external pure returns (int24) { return _maxTick(s); }
}

contract ReviewTest is Test {
    CampaignFactoryV5 cf;
    MockERC20 usdg;
    MockPonsFactoryMut ponsF;
    MockLaunchAndBuy lab;
    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    uint256 constant FEE = 0.001 ether;

    function setUp() public {
        usdg = new MockERC20("USDG");
        ponsF = new MockPonsFactoryMut();
        lab = new MockLaunchAndBuy();
        cf = new CampaignFactoryV5(
            address(0xFEE), address(0x4EAA), 700, 300,
            IPonsV2Factory(address(ponsF)), IPonsV2LaunchAndBuy(address(lab)), address(0xE5C60),
            IPoolManagerMin(address(0xB0)), address(0xB1), IV4StateView(address(0xB2)),
            new LegDeployerV3(), FEE, IERC20(address(0)), 0,
            address(0)
        );
        vm.deal(creator, 20 ether); vm.deal(alice, 20 ether);
        usdg.mint(alice, 100 ether);
    }

    function _params() internal view returns (CampaignParams memory p) {
        p.goal = 1 ether; p.minDeposit = 0.1 ether; p.deadline = block.timestamp + 1 days;
        p.meta = PonsTokenMeta("RV", "RV", "", "t", PonsSocials("", "", "", "", ""), address(0));
        p.allowlist = new address[](0);
    }
    function _create(CampaignParams memory p) internal returns (CampaignV3 c) {
        uint256 v = FEE + (p.quoteToken == address(0) ? 0 : ponsF.launchFee());
        vm.prank(creator);
        c = cf.createCampaign{value: v}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(7)));
    }

    // ── F6: a native raise smaller than pons' launch fee could fill and never launch ──

    function test_F6_goalBelowLaunchFee_rejectedAtCreation() public {
        CampaignParams memory p = _params();
        p.goal = 0.0004 ether; p.minDeposit = 0.0001 ether; // pons fee is 0.0005
        vm.prank(creator);
        vm.expectRevert(CampaignV3.BadAmount.selector);
        cf.createCampaign{value: FEE}(p, 0, 0, new address[](0), new uint16[](0), bytes32(uint256(7)));
    }

    function test_F6_launchRevertsCleanly_whenFeeRisesPastPool_andRefundsOpen() public {
        CampaignParams memory p = _params();
        p.goal = 0.001 ether; p.minDeposit = 0.001 ether;
        CampaignV3 c = _create(p);
        vm.prank(alice); c.deposit{value: 0.001 ether}();
        ponsF.setLaunchFee(0.002 ether); // pons raised its fee above the whole pool
        vm.prank(creator);
        vm.expectRevert(CampaignV3.NotLaunchable.selector); // a named revert, not Panic(0x11)
        c.launch();
        // and the money is never stranded: grace passes, refund works
        vm.warp(p.deadline + 4 days);
        uint256 before = alice.balance;
        vm.prank(alice); c.refund();
        assertEq(alice.balance - before, 0.001 ether, "backer not made whole");
    }

    // ── F8: a zero-address vault leg strands its share forever ──

    function test_F8_zeroVaultRecipient_rejected() public {
        CampaignParams memory p = _params();
        address[] memory r = new address[](1); r[0] = address(0);
        uint16[] memory b = new uint16[](1); b[0] = 500;
        vm.prank(creator);
        vm.expectRevert(CampaignFactoryV5.BadVault.selector);
        cf.createCampaign{value: FEE}(p, 0, 0, r, b, bytes32(uint256(7)));
    }

    function test_F8_zeroBpsVault_rejected() public {
        CampaignParams memory p = _params();
        address[] memory r = new address[](1); r[0] = address(0xDA0);
        uint16[] memory b = new uint16[](1); b[0] = 0;
        vm.prank(creator);
        vm.expectRevert(CampaignFactoryV5.BadVault.selector);
        cf.createCampaign{value: FEE}(p, 0, 0, r, b, bytes32(uint256(7)));
    }

    // ── F3: ERC20-quoted launch stranded the escrow surplus and any stray ETH ──

    function test_F3_escrowSurplus_returnedToCreatorAtLaunch() public {
        CampaignParams memory p = _params();
        p.quoteToken = address(usdg); p.goal = 1 ether; p.minDeposit = 1 ether;
        CampaignV3 c = _create(p); // escrows 0.0005 at creation
        assertEq(c.launchFeeEscrowed(), 0.0005 ether);
        vm.startPrank(alice); usdg.approve(address(c), 1 ether); c.depositToken(1 ether); vm.stopPrank();
        ponsF.setLaunchFee(0.0002 ether); // pons LOWERED its fee before launch
        uint256 before = creator.balance;
        vm.prank(creator); c.launch();
        assertTrue(c.launched());
        assertEq(creator.balance - before, 0.0003 ether, "surplus not returned");
        assertEq(address(c).balance, 0, "native left in an ERC20 campaign");
        assertTrue(c.launchFeeRefunded());
    }

    function test_F3_strayEthAfterLaunch_sweepableToCreator_byAnyone() public {
        CampaignParams memory p = _params();
        p.quoteToken = address(usdg); p.goal = 1 ether; p.minDeposit = 1 ether;
        CampaignV3 c = _create(p);
        vm.startPrank(alice); usdg.approve(address(c), 1 ether); c.depositToken(1 ether); vm.stopPrank();
        vm.prank(creator); c.launch();
        (bool ok, ) = address(c).call{value: 0.01 ether}(""); require(ok);
        uint256 before = creator.balance;
        vm.prank(alice); c.refundLaunchFee(); // permissionless, always pays the creator
        assertEq(creator.balance - before, 0.01 ether);
        assertEq(address(c).balance, 0);
    }

    function test_F3_escrowNotTouchableWhileRaiseIsLive() public {
        CampaignParams memory p = _params();
        p.quoteToken = address(usdg);
        CampaignV3 c = _create(p);
        vm.prank(creator);
        vm.expectRevert(CampaignV3.NotRefundable.selector);
        c.refundLaunchFee();
    }

    function test_F3_nativeCampaign_refundLaunchFee_alwaysReverts() public {
        CampaignParams memory p = _params();
        p.goal = 0.01 ether; p.minDeposit = 0.01 ether;
        CampaignV3 c = _create(p);
        vm.prank(alice); c.deposit{value: 0.01 ether}();
        vm.prank(creator); c.launch();
        (bool ok, ) = address(c).call{value: 0.01 ether}(""); require(ok);
        vm.expectRevert(CampaignV3.NotRefundable.selector); // backers' ETH, not the creator's
        c.refundLaunchFee();
    }

    // ── F5: the vault could pull an ERC20 in and never let it out ──

    function test_F5_vault_refusesNonNativeAssets() public {
        RewardsVault v = new RewardsVault(IERC20Pull(address(usdg)), IEquityRouter(address(0)));
        vm.expectRevert(RewardsVault.NativeOnly.selector);
        v.pokeClaim(ISplitterLegPull(address(0xDEAD)), address(usdg));
    }

    // ── F1: per-call cap was loopable in one tx; v3 legs crank once per block ──

    function _wiredBurnLeg() internal returns (BurnLegV3 leg, MockERC20 tok) {
        tok = new MockERC20("T");
        MockCurve curve = new MockCurve(tok);
        MockCampaignView camp = new MockCampaignView(address(tok), address(curve));
        MockSplitter sp = new MockSplitter();
        leg = new BurnLegV3(address(this), IPoolManagerMin(address(0xB0)), address(0xB1));
        leg.init(ICampaignV2View(address(camp)), IFeeSplitterLegV2(address(sp)), IPonsV2FactoryLegView(address(0xB3)));
        vm.deal(address(leg), 0.5 ether);
    }

    function test_F1_burnLegV3_oneCrankPerBlock_capIsRealPerBlock() public {
        (BurnLegV3 leg, MockERC20 tok) = _wiredBurnLeg();
        leg.crank();
        assertEq(leg.totalEthSpent(), 0.2 ether, "cap not applied");
        assertEq(tok.balanceOf(leg.DEAD()), 0.2 ether * 1000, "burn not delivered");
        vm.expectRevert(BurnLegV3.CrankedThisBlock.selector);
        leg.crank(); // same block: the loop that drained the balance is gone
        vm.roll(block.number + 1);
        leg.crank();
        assertEq(leg.totalEthSpent(), 0.4 ether);
    }

    function test_F1_feedLpV3_oneCrankPerBlock() public {
        MockERC20 tok = new MockERC20("T");
        MockCurve curve = new MockCurve(tok);
        MockCampaignView camp = new MockCampaignView(address(tok), address(curve));
        FeedLPLegV3 leg = new FeedLPLegV3(address(this), IPoolManagerMin(address(0xB0)), address(0xB1), IV4StateView(address(0xB2)));
        leg.init(ICampaignV2View(address(camp)), IFeeSplitterLegV2(address(new MockSplitter())), IPonsV2FactoryLegView(address(0xB3)));
        leg.crank(); // accumulate phase
        vm.expectRevert(FeedLPLegV3.CrankedThisBlock.selector);
        leg.crank();
        vm.roll(block.number + 1);
        leg.crank();
    }

    // ── F4 (fixable half): full-range ticks derived from the pool's spacing ──

    function test_F4_maxTick_alignedAndInRange_forAnySpacing() public {
        TickProbe p = new TickProbe();
        assertEq(p.maxTick(200), 887200); // the old hardcode, reproduced
        int24[6] memory spacings = [int24(1), 10, 60, 200, 475, 9500];
        for (uint256 i = 0; i < spacings.length; i++) {
            int24 s = spacings[i]; int24 m = p.maxTick(s);
            assertEq(m % s, 0, "not aligned");
            assertLe(m, 887272, "beyond MAX_TICK");
            assertGt(m, 887272 - s, "not the widest usable tick");
        }
    }
}
