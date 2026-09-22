// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {CampaignV3, CampaignParams} from "../src/CampaignV3.sol";
import {CampaignFactoryV5} from "../src/CampaignFactoryV5.sol";
import {CampaignV4} from "../src/CampaignV4.sol";
import {CampaignFactoryV6} from "../src/CampaignFactoryV6.sol";
import {FeeSplitterV4} from "../src/FeeSplitterV4.sol";
import {SplitterDeployerV4} from "../src/SplitterDeployerV4.sol";
import {ProofBurner} from "../src/ProofBurner.sol";
import {LegDeployerV3} from "../src/LegDeployerV3.sol";
import {ICampaignV2View, IPonsV2FactoryLegView} from "../src/V4LegBase.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy, IPonsV2FeeEscrow, IPonsV2Curve} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView, PoolKey} from "../src/interfaces/IUniV4.sol";

interface IPonsV2HookView { function feeSweepOperator() external view returns (address); }
interface IERC20Approve { function approve(address spender, uint256 amount) external returns (bool); }
interface IBal { function balanceOf(address) external view returns (uint256); }

contract CurveTrader {
    receive() external payable {}
    function buy(address curve, uint256 quoteIn) external returns (uint256) { return IPonsV2Curve(curve).buy{value: quoteIn}(quoteIn, 0, address(this)); }
    function sell(address curve, address token, uint256 amount) external returns (uint256) { IERC20Approve(token).approve(curve, amount); return IPonsV2Curve(curve).sell(amount, 0, address(this)); }
}

/// THE DRESS REHEARSAL. Launch day, end to end, against LIVE pons V2 and
/// the LIVE router / leg deployer on a mainnet fork, in the exact order the
/// runbook prescribes:
///   1. "$PROOF" launches on the LIVE v7 factory (Burn Heavy preset)
///   2. ProofBurner deploys against it (the DeployProofBurner constructor)
///   3. CampaignFactoryV6 deploys pointing at the burner (DeployV6 args)
///   4. a v8 campaign: locked seat + unlocked seat, launch, real trades on
///      the pons curve, the operator sweep, harvest, hold-weighted claims
///      (a seller forfeits), claim-as-stock through the real router,
///      pull() into the burner, crank() → $PROOF at 0x…dEaD.
/// Run: forge test --match-contract ForkV8Lifecycle --threads 1 -vv
contract ForkV8Lifecycle is Test {
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant PONS_V2_LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    address constant PONS_V2_FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant LIVE_FACTORY_V7 = 0x6928C1Ace232124641e9cfFEfD16D82E1B9c531B;
    address constant LIVE_ROUTER = 0x0A568a0AdcC45F8f6597f0219df39FA9ACA82943;
    address constant LIVE_LEG_DEPLOYER = 0x518B6b80736af35D25F98Cc403A7f2dD8a0763AB;
    address constant SPCX = 0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address constant PLATFORM = address(0xFEE);
    address founder = address(0xF0A5DE2);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address rando = address(0x7A2D0);

    function setUp() public {
        try vm.createSelectFork("rhc") {} catch { vm.skip(true); return; }
        vm.deal(founder, 20 ether); vm.deal(alice, 20 ether); vm.deal(bob, 20 ether); vm.deal(rando, 1 ether);
    }

    function _meta(string memory sym) internal pure returns (PonsTokenMeta memory) {
        return PonsTokenMeta(sym, sym, "", "fork rehearsal - never mainnet", PonsSocials("", "", "", "", ""), address(0));
    }

    function test_forkv8_launchDay_endToEnd() public {
        // ── 1. $PROOF on the LIVE v7 factory, Burn Heavy, 5% tax, SPCX payout ──
        CampaignFactoryV5 v7 = CampaignFactoryV5(LIVE_FACTORY_V7);
        CampaignParams memory p;
        p.goal = 1 ether; p.minDeposit = 0.05 ether; p.deadline = block.timestamp + 1 days; p.creatorTaxBps = 500; p.payoutAsset = SPCX;
        p.meta = _meta("PROOF"); p.allowlist = new address[](0);
        uint256 fee = v7.creationFeeFor(founder);
        vm.prank(founder);
        CampaignV3 proofC = v7.createCampaign{value: fee}(p, 3000, 0, new address[](0), new uint16[](0), bytes32(uint256(0x5eed01)));
        vm.prank(founder); proofC.deposit{value: 0.1 ether}();   // one public seat
        vm.prank(alice); proofC.deposit{value: 0.9 ether}();
        vm.prank(founder); proofC.launch();
        address proofToken = proofC.token();
        assertTrue(proofC.launched()); assertGt(IBal(proofToken).balanceOf(address(proofC)), 0);
        console2.log("1. $PROOF launched on live v7:", proofToken);

        // ── 2. the burner, exactly as DeployProofBurner constructs it ──
        ProofBurner burner = new ProofBurner(ICampaignV2View(address(proofC)), IPonsV2FactoryLegView(PONS_V2_FACTORY), IPoolManagerMin(POOL_MANAGER), MEME_HOOK);
        assertEq(burner.proofToken(), proofToken);
        console2.log("2. burner:", address(burner));

        // ── 3. v8 factory, exactly as DeployV6 constructs it (30/10, live router + leg deployer) ──
        SplitterDeployerV4 sd = new SplitterDeployerV4();
        CampaignFactoryV6 v8 = new CampaignFactoryV6(
            PLATFORM, address(burner), 1000, 3000,
            IPonsV2Factory(PONS_V2_FACTORY), IPonsV2LaunchAndBuy(PONS_V2_LAUNCH_AND_BUY), PONS_V2_FEE_ESCROW,
            IPoolManagerMin(POOL_MANAGER), MEME_HOOK, IV4StateView(STATE_VIEW),
            LegDeployerV3(LIVE_LEG_DEPLOYER), 0.001 ether, IERC20(proofToken), 0, LIVE_ROUTER, address(sd)
        );
        assertEq(v8.proofBurner(), address(burner)); assertEq(v8.proofBurnBps(), 3000); assertEq(v8.platformBps(), 1000);
        console2.log("3. factory v8:", address(v8));

        // ── 4. a v8 campaign: the creation fee goes to the burner ──
        uint256 burnerBefore = address(burner).balance;
        CampaignParams memory q;
        q.goal = 1 ether; q.minDeposit = 0.1 ether; q.deadline = block.timestamp + 1 days; q.creatorTaxBps = 300; q.payoutAsset = SPCX;
        q.meta = _meta("V8T"); q.allowlist = new address[](0);
        vm.prank(founder);
        CampaignV4 c = v8.createCampaign{value: 0.001 ether}(q, 1000, 0, new address[](0), new uint16[](0), bytes32(uint256(0x5eed02)));
        assertEq(address(burner).balance - burnerBefore, 0.001 ether, "creation fee did not reach the burner");
        FeeSplitterV4 s = c.feeSplitter();
        assertEq(s.forfeitTo(), address(burner), "forfeits must point at the burner");
        assertEq(address(s.equityRouter()), LIVE_ROUTER);

        // alice locks a year (weight 1.5), bob doesn't
        vm.prank(alice); c.depositLocked{value: 0.5 ether}(365);
        vm.prank(bob); c.deposit{value: 0.5 ether}();
        assertEq(c.weightedRaised(), 1.25 ether);
        vm.prank(founder); c.launch();
        address token = c.token(); address curve = c.curve();
        assertEq(c.lockUntil(alice), c.launchedAt() + 365 days);
        console2.log("4. v8 campaign launched:", token);

        // ── 5. real trades on the live curve → creator tax accrues ──
        vm.warp(block.timestamp + 60); vm.roll(block.number + 30);
        CurveTrader t = new CurveTrader(); vm.deal(address(t), 2 ether);
        t.buy(curve, 0.3 ether); t.sell(curve, token, IBal(token).balanceOf(address(t)) / 2);
        assertGt(IPonsV2Curve(curve).creatorTaxBalance(), 0, "no creator tax on the curve");
        address sweeper = IPonsV2HookView(MEME_HOOK).feeSweepOperator();
        vm.prank(sweeper); IPonsV2Curve(curve).sweepFees(0);
        vm.prank(rando); c.pokeHarvest();
        uint256 pool = s.backerPool(address(0));
        assertGt(pool, 0, "harvest brought nothing");
        // 30/10 legs + 10% coin burn: backers = 50%
        assertApproxEqAbs(s.legOwed(address(burner), address(0)), (s.accounted(address(0)) * 3000) / 10_000, 5, "burner leg != 30%");
        assertApproxEqAbs(s.legOwed(PLATFORM, address(0)), (s.accounted(address(0)) * 1000) / 10_000, 5, "platform leg != 10%");
        console2.log("5. creator tax harvested; backer pool wei:", pool);

        // ── 6. hold rule: bob claims tokens and sells everything → his share forfeits to the burner ──
        vm.prank(bob); c.claimTokens();
        vm.prank(bob); IERC20Approve(token).approve(curve, type(uint256).max);
        uint256 bobBal = IBal(token).balanceOf(bob); // read BEFORE the prank: an external call in the args would eat it
        vm.prank(bob); IPonsV2Curve(curve).sell(bobBal, 0, bob);
        assertEq(s.heldBps(bob), 0);
        uint256 burnerLegBefore = s.legOwed(address(burner), address(0));
        vm.prank(rando); s.settle(bob, address(0));            // anyone locks the seller's forfeiture in
        uint256 forfeited = s.legOwed(address(burner), address(0)) - burnerLegBefore;
        assertGt(forfeited, 0, "seller forfeited nothing");
        assertEq(s.backerOwed(bob, address(0)), 0, "seller still owed");
        // alice (locked, weight 1.5 vs bob's 1): her entitlement is 60% of the pool
        assertApproxEqAbs(s.backerEntitlement(alice, address(0)), (pool * 3) / 5, 5, "lock weight not applied");
        console2.log("6. bob sold everything; forfeited wei:", forfeited);

        // ── 7. alice claims as SPCX through the LIVE router ──
        uint256 spcxBefore = IBal(SPCX).balanceOf(alice);
        vm.prank(alice); uint256 out = s.claimBackerAs(PoolKey(address(0), SPCX, 3000, 30, address(0)), 0);
        assertGt(out, 0); assertEq(IBal(SPCX).balanceOf(alice) - spcxBefore, out, "SPCX did not land in her wallet");
        assertEq(IBal(SPCX).balanceOf(address(s)), 0); assertEq(IBal(SPCX).balanceOf(LIVE_ROUTER), 0);
        console2.log("7. alice claimed as SPCX, shares (1e18):", out);

        // ── 8. the flywheel: pull the leg into the burner, crank, $PROOF burns ──
        vm.prank(rando); burner.pull(address(s));
        assertGt(burner.totalEthPulled(), 0, "pull collected nothing");
        assertEq(s.legOwed(address(burner), address(0)), 0, "leg not fully pulled");
        uint256 deadBefore = IBal(proofToken).balanceOf(DEAD);
        vm.roll(block.number + 1);
        vm.prank(rando); burner.crank();
        uint256 burned = IBal(proofToken).balanceOf(DEAD) - deadBefore;
        assertGt(burned, 0, "crank burned nothing");
        assertEq(burner.totalTokensBurned(), burned);
        console2.log("8. $PROOF burned by the flywheel:", burned);

        // ── 9. alice's lock holds; the day comes; she claims her tokens ──
        vm.expectRevert(CampaignV4.StillLocked.selector);
        vm.prank(alice); c.claimTokens();
        vm.warp(c.lockUntil(alice));
        vm.prank(alice); c.claimTokens();
        assertGt(IBal(token).balanceOf(alice), 0);
        console2.log("9. lock released on schedule. launch day rehearsed.");
    }
}
