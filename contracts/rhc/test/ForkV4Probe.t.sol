// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IPoolManagerMin, IV4StateView, PoolKey, V4SwapParams, V4ModifyLiquidityParams, V4Delta} from "../src/interfaces/IUniV4.sol";
import {IERC20} from "../src/interfaces/IPons.sol";

interface IERC20Xfer {
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// Ground-truth probe: can a third-party contract (a) swap and (b) add
/// full-range liquidity DIRECTLY on a pons-graduated Uniswap v4 pool, or
/// does the pons memeHook block outsiders? Everything else about the v4
/// bot legs depends on these answers.
contract V4Probe {
    using V4Delta for int256;

    IPoolManagerMin immutable pm;
    PoolKey key;

    constructor(IPoolManagerMin pm_, PoolKey memory key_) {
        pm = pm_;
        key = key_;
    }

    receive() external payable {}

    // ── swap ETH -> token ────────────────────────────────────────────
    function swapIn(uint256 ethIn) external returns (uint256 out) {
        bytes memory r = pm.unlock(abi.encode(uint8(1), ethIn));
        out = abi.decode(r, (uint256));
    }

    // ── add full-range liquidity ─────────────────────────────────────
    function addLiquidity(int256 liq) external {
        pm.unlock(abi.encode(uint8(2), uint256(liq)));
    }

    // ── compound poke (liquidityDelta = 0) ───────────────────────────
    function poke() external returns (int256 fees) {
        bytes memory r = pm.unlock(abi.encode(uint8(3), uint256(0)));
        fees = abi.decode(r, (int256));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "not pm");
        (uint8 mode, uint256 amt) = abi.decode(data, (uint8, uint256));
        if (mode == 1) {
            int256 delta = pm.swap(
                key,
                V4SwapParams({zeroForOne: true, amountSpecified: -int256(amt), sqrtPriceLimitX96: 4295128740}),
                ""
            );
            int128 a0 = delta.amount0();
            int128 a1 = delta.amount1();
            console2.log("swap delta a0", a0);
            console2.log("swap delta a1", a1);
            if (a0 < 0) pm.settle{value: uint256(uint128(-a0))}();
            uint256 out = 0;
            if (a1 > 0) {
                out = uint256(uint128(a1));
                pm.take(key.currency1, address(this), out);
            }
            return abi.encode(out);
        }
        if (mode == 2 || mode == 3) {
            (int256 callerDelta, int256 feesAccrued) = pm.modifyLiquidity(
                key,
                V4ModifyLiquidityParams({tickLower: -887200, tickUpper: 887200, liquidityDelta: int256(amt), salt: bytes32(0)}),
                ""
            );
            int128 a0 = callerDelta.amount0();
            int128 a1 = callerDelta.amount1();
            console2.log("modLiq delta a0", a0);
            console2.log("modLiq delta a1", a1);
            if (a0 < 0) pm.settle{value: uint256(uint128(-a0))}();
            if (a1 < 0) {
                pm.sync(key.currency1);
                IERC20Xfer(key.currency1).transfer(address(pm), uint256(uint128(-a1)));
                pm.settle();
            }
            if (a0 > 0) pm.take(key.currency0, address(this), uint256(uint128(a0)));
            if (a1 > 0) pm.take(key.currency1, address(this), uint256(uint128(a1)));
            return abi.encode(feesAccrued);
        }
        revert("bad mode");
    }
}

contract ForkV4ProbeTest is Test {
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    // a live graduated pons V2 token (phase 2, found 2026-09-14)
    address constant GRAD_TOKEN = 0x3ECd081872BcA5f0F78dC65AA2031b7b5805d1D1;
    string constant RPC = "https://rpc.mainnet.chain.robinhood.com";

    function test_probe_v4_swap_and_liquidity() public {
        try vm.createSelectFork(RPC) {} catch {
            vm.skip(true);
            return;
        }
        PoolKey memory key = PoolKey({
            currency0: address(0),
            currency1: GRAD_TOKEN,
            fee: 0,
            tickSpacing: 200,
            hooks: MEME_HOOK
        });
        bytes32 poolId = keccak256(abi.encode(key));
        (uint160 sqrtP, int24 tick,,) = IV4StateView(STATE_VIEW).getSlot0(poolId);
        console2.log("pool sqrtPriceX96", sqrtP);
        console2.log("pool tick", tick);
        assertGt(sqrtP, 0, "pool not initialized at this key - key shape wrong");

        V4Probe probe = new V4Probe(IPoolManagerMin(POOL_MANAGER), key);
        vm.deal(address(probe), 1 ether);

        // (a) direct swap
        uint256 out = probe.swapIn(0.05 ether);
        console2.log("tokens out", out);
        assertGt(out, 0, "hook blocked direct swap");
        assertEq(IERC20(GRAD_TOKEN).balanceOf(address(probe)), out, "tokens not received");

        // (b) third-party full-range liquidity
        probe.addLiquidity(1e15);
        uint128 posLiq = IV4StateView(STATE_VIEW).getPositionLiquidity(
            poolId,
            keccak256(abi.encodePacked(address(probe), int24(-887200), int24(887200), bytes32(0)))
        );
        console2.log("our position liquidity", posLiq);
        assertGt(posLiq, 0, "hook blocked third-party liquidity");

        // (c) compound poke works
        probe.poke();
    }
}
