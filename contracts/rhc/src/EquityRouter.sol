// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManagerMin, PoolKey, V4SwapParams, V4Delta} from "./interfaces/IUniV4.sol";

/// ETH in, any asset out — the one primitive behind "get paid in stock".
///
/// Ownerless, stateless between calls, and holds nothing. It exists so a
/// claimer can route their OWN entitlement through a swap in the same
/// transaction that pays them: the protocol always owes ETH, and the
/// recipient decides what lands in their wallet.
///
/// DELIBERATELY PERMISSIONLESS. There is no allowlist of "approved"
/// assets, because an allowlist is an admin, and an admin is the one
/// thing this architecture refuses to have. The caller supplies the
/// PoolKey, so the day Robinhood tokenizes anything new it works here
/// with no deploy, no vote, and no permission. A caller who points this
/// at a bad pool gets a bad price and their own minOut stops it — the
/// risk is theirs and it is bounded by a number they chose.
contract EquityRouter {
    using V4Delta for int256;

    /// v4 MIN_SQRT_PRICE + 1 — the limit for a zeroForOne (ETH → asset) swap.
    uint160 internal constant MIN_SQRT = 4295128740;

    IPoolManagerMin public immutable poolManager;

    /// Set only for the duration of one unlock: authenticates the callback
    /// and doubles as the reentrancy guard. Plain storage, not transient —
    /// this is an Orbit L2 and V4LegBase's live legs use the same pattern;
    /// TSTORE support is not worth assuming for the gas it saves.
    address private _unlocking;

    event Routed(
        address indexed payer,
        address indexed recipient,
        address indexed asset,
        uint256 ethIn,
        uint256 assetOut
    );

    error NotNativePair();
    error NothingIn();
    error BadRecipient();
    error Reentrant();
    error BadCallback();
    error Slippage(uint256 out, uint256 minOut);
    error RefundFailed();

    constructor(IPoolManagerMin poolManager_) {
        poolManager = poolManager_;
    }

    /// Native credits can only land here via `take` on a degenerate pool;
    /// accept them so they can be refunded rather than trapped.
    receive() external payable {}

    /// Swap the full `msg.value` into `key.currency1` and deliver it to
    /// `recipient`. Reverts unless at least `minOut` arrives.
    ///
    /// `key.currency0` MUST be native ETH (address(0)) — v4 sorts address(0)
    /// first, so for any ETH-paired pool the target asset is currency1.
    function routeEthTo(
        PoolKey calldata key,
        uint256 minOut,
        address recipient,
        bytes calldata hookData
    ) external payable returns (uint256 assetOut) {
        if (key.currency0 != address(0)) revert NotNativePair();
        if (msg.value == 0) revert NothingIn();
        if (recipient == address(0)) revert BadRecipient();
        if (_unlocking != address(0)) revert Reentrant();

        _unlocking = address(poolManager);
        bytes memory res = poolManager.unlock(abi.encode(key, msg.value, recipient, hookData));
        _unlocking = address(0);

        assetOut = abi.decode(res, (uint256));
        if (assetOut < minOut) revert Slippage(assetOut, minOut);

        // Exact-input consumes the whole amount, but never let dust stick to
        // an ownerless contract: anything left is the payer's.
        uint256 dust = address(this).balance;
        if (dust > 0) {
            (bool ok, ) = msg.sender.call{value: dust}("");
            if (!ok) revert RefundFailed();
        }

        emit Routed(msg.sender, recipient, key.currency1, msg.value, assetOut);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != _unlocking || _unlocking == address(0)) revert BadCallback();

        (PoolKey memory key, uint256 amountIn, address recipient, bytes memory hookData) =
            abi.decode(data, (PoolKey, uint256, address, bytes));

        // Negative amountSpecified = exact input.
        int256 delta = poolManager.swap(
            key,
            V4SwapParams({
                zeroForOne: true,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: MIN_SQRT
            }),
            hookData
        );

        int128 a0 = delta.amount0();
        int128 a1 = delta.amount1();

        // We owe native for what we spent…
        if (a0 < 0) poolManager.settle{value: uint256(uint128(-a0))}();
        // …and a well-formed pool never asks us for the asset on this leg.
        if (a1 < 0) revert NotNativePair();

        // Unspent native (partial fill against the price limit) comes back
        // here and is refunded to the payer by routeEthTo.
        if (a0 > 0) poolManager.take(address(0), address(this), uint256(uint128(a0)));

        uint256 out;
        if (a1 > 0) {
            out = uint256(uint128(a1));
            // Straight to the claimer — the router never custodies the asset.
            poolManager.take(key.currency1, recipient, out);
        }
        return abi.encode(out);
    }
}
