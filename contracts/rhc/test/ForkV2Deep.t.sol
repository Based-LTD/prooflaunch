// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {CampaignV2} from "../src/CampaignV2.sol";
import {CampaignFactoryV3} from "../src/CampaignFactoryV3.sol";
import {LegDeployerV2} from "../src/LegDeployerV2.sol";
import {BurnLegV2} from "../src/BurnLegV2.sol";
import {FeedLPLegV2} from "../src/FeedLPLegV2.sol";
import {FeeSplitterV2} from "../src/FeeSplitterV2.sol";
import {IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy, IPonsV2Curve} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView, PoolKey} from "../src/interfaces/IUniV4.sol";
import {V4Probe} from "./ForkV4Probe.t.sol";

interface IPonsV2FactoryGrad {
    function graduate(address token) external;
    function createGraduatedPool(address token) external returns (uint256 positionId);
}

interface IERC20Full {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Deep fork tests: the trustless bot legs (v4 ports) against LIVE pons V2.
/// Run with: forge test --match-contract ForkV2Deep --threads 1 -vv
contract ForkV2Deep is Test {
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant PONS_V2_LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    address constant PONS_V2_FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    string constant RPC = "https://rpc.mainnet.chain.robinhood.com";

    CampaignFactoryV3 cf;
    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);

    function setUp() public {
        try vm.createSelectFork(RPC) {} catch {
            vm.skip(true);
            return;
        }
        cf = new CampaignFactoryV3(
            address(0xFEE), address(0x4EAA), 700, 300,
            IPonsV2Factory(PONS_V2_FACTORY),
            IPonsV2LaunchAndBuy(PONS_V2_LAUNCH_AND_BUY),
            PONS_V2_FEE_ESCROW,
            IPoolManagerMin(POOL_MANAGER),
            MEME_HOOK,
            IV4StateView(STATE_VIEW),
            new LegDeployerV2()
        );
        vm.deal(alice, 10 ether);
    }

    function _meta() internal pure returns (PonsTokenMeta memory) {
        return PonsTokenMeta(
            "PoolLaunch V4Bots Probe", "PLB4", "", "fork test - never mainnet",
            PonsSocials("", "", "", "", ""), address(0)
        );
    }

    function _create(uint16 burnBps, uint16 lpBps) internal returns (CampaignV2 c) {
        vm.prank(creator);
        c = cf.createCampaign(
            1 ether, 0.1 ether, 8 ether, 24,
            block.timestamp + 1 days,
            0, 300, false, _meta(),
            burnBps, lpBps,
            new address[](0), new uint16[](0)
        );
    }

    function _legs(CampaignV2 c, bool hasBurn, bool hasLp) internal view returns (address burn, address lp) {
        // splitter leg order: [rewards, burn?, lp?, ...vaults, platform]
        FeeSplitterV2 s = c.feeSplitter();
        uint256 i = 1;
        if (hasBurn) burn = s.legRecipients(i++);
        if (hasLp) lp = s.legRecipients(i);
    }

    // ── burn bot, curve phase ────────────────────────────────────────
    function test_forkv2_burnLeg_curvePhase() public {
        CampaignV2 c = _create(2000, 0);
        vm.prank(alice); c.deposit{value: 1 ether}();
        vm.prank(creator); c.launch();
        assertFalse(IPonsV2Curve(c.curve()).graduated(), "1 ETH should not graduate");

        (address burn, ) = _legs(c, true, false);
        address token = c.token();
        uint256 deadBefore = IERC20(token).balanceOf(DEAD);

        // simulate accumulated fee claims, then crank as a rando
        vm.deal(burn, 0.05 ether);
        vm.warp(block.timestamp + 60); vm.roll(block.number + 30);
        vm.prank(address(0xBEEF));
        BurnLegV2(payable(burn)).crank();

        uint256 burned = IERC20(token).balanceOf(DEAD) - deadBefore;
        console2.log("burned via curve:", burned);
        assertGt(burned, 0, "curve-phase burn failed");
        assertEq(address(burn).balance, 0, "ETH not fully spent");
    }

    // ── burn + LP bots, v4 phase (oversized raise graduates at birth) ─
    function test_forkv2_bots_v4Phase() public {
        CampaignV2 c = _create(1000, 1000);
        vm.prank(alice); c.deposit{value: 6 ether}();
        vm.prank(creator); c.launch();
        address token = c.token();
        assertTrue(IPonsV2Curve(c.curve()).graduated(), "6 ETH should graduate the curve");

        // the v4 pool may need the permissionless graduation cranks
        PoolKey memory key = PoolKey(address(0), token, 0, 200, MEME_HOOK);
        bytes32 poolId = keccak256(abi.encode(key));
        (uint160 sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(poolId);
        if (sqrtP == 0) {
            vm.startPrank(address(0xBEEF));
            try IPonsV2FactoryGrad(PONS_V2_FACTORY).graduate(token) {} catch {}
            try IPonsV2FactoryGrad(PONS_V2_FACTORY).createGraduatedPool(token) returns (uint256 pid) {
                console2.log("createGraduatedPool by rando ok, positionId", pid);
            } catch {
                console2.log("createGraduatedPool gated");
            }
            vm.stopPrank();
            (sqrtP,,,) = IV4StateView(STATE_VIEW).getSlot0(poolId);
        }
        assertGt(sqrtP, 0, "v4 pool never came up after graduation");

        (address burn, address lp) = _legs(c, true, true);

        // ── burn leg via v4 swap ──
        uint256 deadBefore = IERC20(token).balanceOf(DEAD);
        vm.deal(burn, 0.05 ether);
        vm.prank(address(0xBEEF));
        BurnLegV2(payable(burn)).crank();
        uint256 burned = IERC20(token).balanceOf(DEAD) - deadBefore;
        console2.log("burned via v4 swap:", burned);
        assertGt(burned, 0, "v4-phase burn failed");

        // ── LP leg: fund both sides, crank mints locked liquidity ──
        V4Probe probe = new V4Probe(IPoolManagerMin(POOL_MANAGER), key);
        vm.deal(address(probe), 1 ether);
        uint256 got = probe.swapIn(0.2 ether);
        vm.prank(address(probe));
        IERC20Full(token).transfer(lp, got);
        vm.deal(lp, 0.05 ether);

        vm.prank(address(0xBEEF));
        FeedLPLegV2(payable(lp)).crank();
        bytes32 posKey = keccak256(abi.encodePacked(lp, int24(-887200), int24(887200), bytes32(0)));
        uint128 posLiq = IV4StateView(STATE_VIEW).getPositionLiquidity(poolId, posKey);
        console2.log("LP leg position liquidity:", posLiq);
        assertGt(posLiq, 0, "LP leg minted nothing");
        assertEq(FeedLPLegV2(payable(lp)).totalLiquidityAdds(), 1);

        // trade to accrue in-range fees, then compound crank
        probe.swapIn(0.1 ether);
        vm.deal(lp, 0.01 ether);
        vm.prank(address(0xBEEF));
        FeedLPLegV2(payable(lp)).crank();
        uint128 posLiq2 = IV4StateView(STATE_VIEW).getPositionLiquidity(poolId, posKey);
        console2.log("after compound crank:", posLiq2);
        assertGe(posLiq2, posLiq, "compound crank shrank the position?!");
        assertEq(FeedLPLegV2(payable(lp)).totalLiquidityAdds(), 2);
    }

    // ── LP leg accumulates gracefully during curve phase ─────────────
    function test_forkv2_lpLeg_curvePhase_accumulates() public {
        CampaignV2 c = _create(0, 1000);
        vm.prank(alice); c.deposit{value: 1 ether}();
        vm.prank(creator); c.launch();
        (, address lp) = _legs(c, false, true);
        vm.deal(lp, 0.03 ether);
        vm.prank(address(0xBEEF));
        FeedLPLegV2(payable(lp)).crank(); // must not revert, must hold funds
        assertEq(address(lp).balance, 0.03 ether, "curve-phase LP leg should just hold");
    }
}
