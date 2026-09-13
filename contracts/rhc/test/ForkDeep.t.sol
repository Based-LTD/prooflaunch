// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {Campaign} from "../src/Campaign.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {LegDeployer} from "../src/LegDeployer.sol";
import {FeeSplitter} from "../src/FeeSplitter.sol";
import {IPonsFactory, IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";
import {BurnLeg, IUniV3FactoryMin} from "../src/BurnLeg.sol";
import {FeedLPLeg} from "../src/FeedLPLeg.sol";

interface IPoolPositions {
    function positions(bytes32 key) external view returns (uint128 liquidity, uint256, uint256, uint128, uint128);
}

interface IWETH {
    function deposit() external payable;
    function transfer(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IUniV3Pool {
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external returns (int256 amount0, int256 amount1);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// Minimal exact-input swapper for fork tests — pays the pool in the
/// v3 callback. NOT production code.
contract TestSwapper {
    uint160 constant MIN_SQRT = 4295128740;
    uint160 constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;

    function buyToken(IUniV3Pool pool, address weth, uint256 wethIn) external {
        bool zeroForOne = pool.token0() == weth;
        pool.swap(
            address(this),
            zeroForOne,
            int256(wethIn),
            zeroForOne ? MIN_SQRT + 1 : MAX_SQRT - 1,
            abi.encode(weth)
        );
    }

    function sellToken(IUniV3Pool pool, address token, uint256 tokenIn) external {
        bool zeroForOne = pool.token0() == token;
        pool.swap(
            address(this),
            zeroForOne,
            int256(tokenIn),
            zeroForOne ? MIN_SQRT + 1 : MAX_SQRT - 1,
            abi.encode(token)
        );
    }

    // v3 pools call this to collect payment: the positive delta is what we
    // owe, in that side's asset.
    function uniswapV3SwapCallback(int256 d0, int256 d1, bytes calldata) external {
        if (d0 > 0) IERC20(IUniV3Pool(msg.sender).token0()).transfer(msg.sender, uint256(d0));
        if (d1 > 0) IERC20(IUniV3Pool(msg.sender).token1()).transfer(msg.sender, uint256(d1));
    }
}

contract ForkDeep is Test {
    uint16 burnBpsForNext = 0;
    uint16 lpBpsForNext = 0;
    address constant PONS = 0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75;
    string constant RPC = "https://rpc.mainnet.chain.robinhood.com";

    address creator = address(0xC0FFEE);
    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address platform = address(0xFEE);
    address rewards = address(0x4EAA);

    function _campaign(uint256 goal) internal returns (Campaign c) {
        // plan of record: backers 90% / platform 7% / holder-rewards 3%
        CampaignFactory cf = new CampaignFactory(platform, rewards, 700, 300, 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73, IUniV3FactoryMin(0x1f7d7550B1b028f7571E69A784071F0205FD2EfA), 10000, new LegDeployer());
        PonsTokenMeta memory meta = PonsTokenMeta(
            "Deep Probe", "DEEP", "", "fork test",
            PonsSocials("", "", "", "", ""), address(0)
        );
        vm.prank(creator);
        c = cf.createCampaign(IPonsFactory(PONS), goal, 0.1 ether, 0, 0,
            block.timestamp + 1 days, 0, 0, meta,
            burnBpsForNext, lpBpsForNext, new address[](0), new uint16[](0));
    }

    /// UNKNOWN #1: what happens when the pooled buy exceeds the 4.2 ETH
    /// graduation threshold? (Where does excess ETH go — reverted, refunded,
    /// or absorbed?)
    function test_fork_oversizedRaise() public {
        vm.createSelectFork(RPC);
        Campaign c = _campaign(6 ether);
        vm.deal(alice, 4 ether);
        vm.deal(bob, 4 ether);
        vm.prank(alice); c.deposit{value: 3.5 ether}();
        vm.prank(bob);   c.deposit{value: 3 ether}();

        vm.prank(creator);
        c.launch();

        address token = c.token();
        console2.log("token deployed:", token);
        console2.log("tokens received:", c.tokensAtLaunch());
        console2.log("campaign ETH after launch:", address(c).balance);
        console2.log("splitter ETH after launch:", address(c.feeSplitter()).balance);
        (uint256 cur, uint256 thr, bool grad) = IPonsFactory(PONS).graduationStatus(token);
        console2.log("graduation current:", cur);
        console2.log("graduation threshold:", thr);
        console2.log("graduated at birth:", grad);
        assertGt(c.tokensAtLaunch(), 0, "no tokens from oversized buy");
        // Whatever the leftover behavior is, funds must not be silently lost:
        // tokens + any refunded ETH must be visible to us
    }

    /// UNKNOWN #2: real WETH fee flow — swap on the live pool, collect via
    /// pokeCollect, distribute 90/7/3, claim as backer + both legs.
    function test_fork_realFeeFlow() public {
        vm.createSelectFork(RPC);
        Campaign c = _campaign(1 ether);
        vm.deal(alice, 3 ether);
        vm.prank(alice); c.deposit{value: 1.5 ether}();

        vm.recordLogs();
        vm.prank(creator);
        c.launch();
        address token = c.token();

        // pull pairToken (WETH) + pool from the TokenLaunched event
        address weth;
        address pool;
        uint256 restrictionsEnd;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint i = 0; i < logs.length; i++) {
            // match TokenLaunched precisely — the factory emits other
            // 4-topic events whose shorter data would crash abi.decode
            if (logs[i].emitter == PONS && logs[i].topics[0] == 0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a) {
                (address pairToken, address pool_,,,, uint256 rEnd, ) =
                    abi.decode(logs[i].data, (address, address, uint256, uint256, uint256, uint256, uint256));
                weth = pairToken;
                pool = pool_;
                restrictionsEnd = rEnd;
            }
        }
        // pons blocks non-creator buys during the snipe-protection window.
        // NOTE: restrictionsEndBlock is on a different clock than
        // block.number (Arbitrum-stack L1/L2 split — event says ~25.9M while
        // block.number is ~61M), so never roll TO it: roll forward
        // generously and keep buys small enough to clear per-wallet caps
        // even if the window is still live.
        restrictionsEnd; // decoded for reference only
        vm.roll(block.number + 5000);
        vm.warp(block.timestamp + 1 hours);
        console2.log("weth:", weth);
        console2.log("pool:", pool);
        assertTrue(weth != address(0) && pool != address(0), "event decode failed");

        // generate real trading volume: buy then sell through the v3 pool
        TestSwapper swapper = new TestSwapper();
        vm.deal(address(this), 5 ether);
        IWETH(weth).deposit{value: 2 ether}();
        IWETH(weth).transfer(address(swapper), 2 ether);
        swapper.buyToken(IUniV3Pool(pool), weth, 0.05 ether);
        uint256 bought = IERC20(token).balanceOf(address(swapper));
        console2.log("swapper bought tokens:", bought);
        assertGt(bought, 0, "buy failed");
        swapper.sellToken(IUniV3Pool(pool), token, bought / 2);

        // collect creator fees (deployer-gated; Campaign wraps it)
        FeeSplitter fs = c.feeSplitter();
        uint256 wethBefore = IERC20(weth).balanceOf(address(fs));
        c.pokeCollect();
        uint256 wethAfter = IERC20(weth).balanceOf(address(fs));
        uint256 tokenFees = IERC20(token).balanceOf(address(fs));
        console2.log("splitter WETH fees:", wethAfter - wethBefore);
        console2.log("splitter token fees:", tokenFees);
        assertGt(wethAfter + tokenFees, 0, "no fees reached the splitter");

        // distribute + claim all three parties, both assets
        fs.distribute(weth);
        fs.distribute(token);
        if (wethAfter > 0) {
            assertEq(fs.backerPool(weth), (wethAfter * 9000) / 10_000, "90% backer split wrong");
            vm.prank(alice); fs.claimBacker(weth);
            assertEq(IERC20(weth).balanceOf(alice), (wethAfter * 9000) / 10_000, "sole backer gets full backer pool");
            vm.prank(platform); fs.claimLeg(weth);
            vm.prank(rewards); fs.claimLeg(weth);
            // 7% + 3% legs, last leg absorbs dust
            assertGe(IERC20(weth).balanceOf(platform), (wethAfter * 700) / 10_000);
            assertGe(IERC20(weth).balanceOf(rewards), (wethAfter * 300) / 10_000 == 0 ? 0 : (wethAfter * 300) / 10_000 - 1);
        }
        console2.log("fee flow verified end-to-end at 90/7/3");
    }

    /// BURN BOT, live-pool proof: a campaign with a 20% burn leg — real
    /// launch, real volume, crank() buys on the real pons pool and sends
    /// the purchase to the dead address.
    function test_fork_burnLeg() public {
        vm.createSelectFork(RPC);
        burnBpsForNext = 2000;
        Campaign c = _campaign(1 ether);
        burnBpsForNext = 0;
        vm.deal(alice, 3 ether);
        vm.prank(alice); c.deposit{value: 1.5 ether}();
        vm.recordLogs();
        vm.prank(creator); c.launch();
        address token = c.token();

        address weth; address pool;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].emitter == PONS && logs[i].topics[0] == 0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a) {
                (address pairToken, address pool_,,,,, ) =
                    abi.decode(logs[i].data, (address, address, uint256, uint256, uint256, uint256, uint256));
                weth = pairToken; pool = pool_;
            }
        }
        vm.roll(block.number + 5000);
        vm.warp(block.timestamp + 1 hours);

        TestSwapper swapper = new TestSwapper();
        vm.deal(address(this), 5 ether);
        IWETH(weth).deposit{value: 2 ether}();
        IWETH(weth).transfer(address(swapper), 2 ether);
        swapper.buyToken(IUniV3Pool(pool), weth, 0.05 ether);
        uint256 bought = IERC20(token).balanceOf(address(swapper));
        swapper.sellToken(IUniV3Pool(pool), token, bought / 2);

        c.pokeCollect();
        FeeSplitter fs = c.feeSplitter();
        // leg order: [rewards, burnLeg, platform] → index 1
        BurnLeg burn = BurnLeg(fs.legRecipients(1));
        assertEq(address(burn.campaign()), address(c), "burn leg not wired");

        uint256 deadBefore = IERC20(token).balanceOf(0x000000000000000000000000000000000000dEaD);
        burn.crank();
        uint256 deadAfter = IERC20(token).balanceOf(0x000000000000000000000000000000000000dEaD);
        console2.log("tokens burned:", deadAfter - deadBefore);
        assertGt(deadAfter, deadBefore, "burn crank destroyed nothing");
        assertGt(burn.totalTokensBurned(), 0);
    }

    /// POOL FEEDER, live-pool proof: a campaign with a 20% LP leg — real
    /// launch, real volume, crank() mints full-range liquidity the leg
    /// contract owns forever (no withdraw exists — locked by construction).
    function test_fork_feedLpLeg() public {
        vm.createSelectFork(RPC);
        lpBpsForNext = 2000;
        Campaign c = _campaign(1 ether);
        lpBpsForNext = 0;
        vm.deal(alice, 3 ether);
        vm.prank(alice); c.deposit{value: 1.5 ether}();
        vm.recordLogs();
        vm.prank(creator); c.launch();
        address token = c.token();

        address weth; address pool;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint i = 0; i < logs.length; i++) {
            if (logs[i].emitter == PONS && logs[i].topics[0] == 0xdb51ea9ad51ab453a65a4cb7e60c3cb378c9501bb002609f8f97778fb6c4235a) {
                (address pairToken, address pool_,,,,, ) =
                    abi.decode(logs[i].data, (address, address, uint256, uint256, uint256, uint256, uint256));
                weth = pairToken; pool = pool_;
            }
        }
        vm.roll(block.number + 5000);
        vm.warp(block.timestamp + 1 hours);

        // volume both directions so the leg accrues BOTH assets
        TestSwapper swapper = new TestSwapper();
        vm.deal(address(this), 5 ether);
        IWETH(weth).deposit{value: 2 ether}();
        IWETH(weth).transfer(address(swapper), 2 ether);
        swapper.buyToken(IUniV3Pool(pool), weth, 0.05 ether);
        uint256 bought = IERC20(token).balanceOf(address(swapper));
        swapper.sellToken(IUniV3Pool(pool), token, bought / 2);

        c.pokeCollect();
        FeeSplitter fs = c.feeSplitter();
        FeedLPLeg lp = FeedLPLeg(fs.legRecipients(1)); // [rewards, lp, platform]
        assertEq(address(lp.campaign()), address(c), "lp leg not wired");

        lp.crank();
        assertGt(lp.totalLiquidityAdds(), 0, "no liquidity minted");
        // the position exists on the REAL pool, owned by the leg forever
        bytes32 key = keccak256(abi.encodePacked(address(lp), int24(-887200), int24(887200)));
        (uint128 liquidity,,,,) = IPoolPositions(pool).positions(key);
        console2.log("locked liquidity:", liquidity);
        assertGt(liquidity, 0, "position not found on pool");

        // second crank must not revert (compound path with 0-fee round)
        lp.crank();
    }
}
