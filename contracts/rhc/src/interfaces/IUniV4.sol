// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal Uniswap v4 core surface — vendored so the bot legs stay
/// dependency-free. pons V2 graduated pools live on the pons-deployed
/// PoolManager (0x8366a39C…) with the pons memeHook attached; poolFee is 0
/// (the hook takes its fee) and tickSpacing is 200.
///
/// v4 conventions that matter here:
///   - native ETH is currency address(0) and always sorts as currency0
///   - every interaction happens inside poolManager.unlock(); the manager
///     calls back unlockCallback(data) and all deltas must be settled
///     before returning (settle{value} for native owed, sync+transfer+
///     settle for ERC20 owed, take() for credits)
///   - BalanceDelta packs (amount0 int128 << 128 | amount1 int128);
///     positive = credited to caller, negative = caller owes
///   - exact-input swaps pass NEGATIVE amountSpecified

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct V4SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

struct V4ModifyLiquidityParams {
    int24 tickLower;
    int24 tickUpper;
    int256 liquidityDelta;
    bytes32 salt;
}

interface IPoolManagerMin {
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, V4SwapParams memory params, bytes calldata hookData)
        external returns (int256 delta);
    function modifyLiquidity(PoolKey memory key, V4ModifyLiquidityParams memory params, bytes calldata hookData)
        external returns (int256 callerDelta, int256 feesAccrued);
    function settle() external payable returns (uint256);
    function sync(address currency) external;
    function take(address currency, address to, uint256 amount) external;
}

interface IV4StateView {
    function getSlot0(bytes32 poolId)
        external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity);
    function getPositionLiquidity(bytes32 poolId, bytes32 positionId) external view returns (uint128 liquidity);
}

library V4Delta {
    function amount0(int256 delta) internal pure returns (int128) {
        return int128(delta >> 128);
    }

    function amount1(int256 delta) internal pure returns (int128) {
        return int128(delta);
    }
}
