// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManagerMin, IV4StateView, PoolKey, V4SwapParams, V4ModifyLiquidityParams, V4Delta} from "./interfaces/IUniV4.sol";
import {IERC20} from "./interfaces/IPons.sol";

interface IERC20Xfer {
    function transfer(address to, uint256 amount) external returns (bool);
}

interface ICampaignV2View {
    function token() external view returns (address);
    function curve() external view returns (address);
    function launched() external view returns (bool);
}

interface IFeeSplitterLegV2 {
    function claimLeg(address asset) external;
}

interface IPonsV2FactoryLegView {
    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        uint8 phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
}

interface IPonsV2CurveLeg {
    function graduated() external view returns (bool);
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
}

/// Shared Uniswap-v4 plumbing for the trustless bot legs on pons V2 pools.
/// Proven against a live graduated pool (ForkV4Probe): the pons memeHook
/// admits third-party swaps AND third-party liquidity, so the legs talk to
/// the PoolManager directly — no router, no Permit2, no dependencies.
abstract contract V4LegBase {
    using V4Delta for int256;

    uint160 internal constant MIN_SQRT = 4295128740;              // v4 MIN_SQRT_PRICE + 1
    int24 internal constant TICK_LOWER = -887200;                 // full range at spacing 200
    int24 internal constant TICK_UPPER = 887200;

    address public immutable initializer; // deployer satellite's caller (our factory)
    IPoolManagerMin public immutable poolManager;
    address public immutable memeHook;

    ICampaignV2View public campaign;
    IFeeSplitterLegV2 public splitter;
    IPonsV2FactoryLegView public ponsFactory;

    address internal _pendingUnlock; // callback auth for the in-flight unlock

    error AlreadyInit();
    error OnlyFactory();
    error NotLaunched();
    error BadCallback();

    constructor(address initializer_, IPoolManagerMin poolManager_, address memeHook_) {
        initializer = initializer_;
        poolManager = poolManager_;
        memeHook = memeHook_;
    }

    /// ETH arrives from splitter leg claims and curve refunds.
    receive() external payable {}

    function init(ICampaignV2View campaign_, IFeeSplitterLegV2 splitter_, IPonsV2FactoryLegView ponsFactory_) external {
        if (msg.sender != initializer) revert OnlyFactory();
        if (address(campaign) != address(0)) revert AlreadyInit();
        campaign = campaign_;
        splitter = splitter_;
        ponsFactory = ponsFactory_;
    }

    /// The graduated pool's key: native ETH is currency0 by construction
    /// (address(0) sorts first); fee/spacing come from the pons launch
    /// record; the hook is fixed per pons deployment.
    function _poolKey(address token) internal view returns (PoolKey memory k) {
        IPonsV2FactoryLegView.LaunchedToken memory info = ponsFactory.getLaunchedToken(token);
        k = PoolKey({
            currency0: address(0),
            currency1: token,
            fee: info.poolFee,
            tickSpacing: info.tickSpacing,
            hooks: memeHook
        });
    }

    function _claimBoth(address token) internal {
        // "nothing to claim" reverts are fine — balance may remain from
        // prior pulls
        try splitter.claimLeg(address(0)) {} catch {}
        try splitter.claimLeg(token) {} catch {}
    }

    // ── unlock plumbing ──────────────────────────────────────────────

    function _unlock(bytes memory data) internal returns (bytes memory) {
        _pendingUnlock = address(poolManager);
        bytes memory r = poolManager.unlock(data);
        _pendingUnlock = address(0);
        return r;
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != _pendingUnlock || _pendingUnlock == address(0)) revert BadCallback();
        return _handleUnlock(data);
    }

    function _handleUnlock(bytes calldata data) internal virtual returns (bytes memory);

    /// Settle what we owe / take what we're owed after a swap or a
    /// liquidity change. currency0 is always native here.
    function _settleDelta(PoolKey memory k, int256 delta) internal {
        int128 a0 = delta.amount0();
        int128 a1 = delta.amount1();
        if (a0 < 0) poolManager.settle{value: uint256(uint128(-a0))}();
        if (a1 < 0) {
            poolManager.sync(k.currency1);
            IERC20Xfer(k.currency1).transfer(address(poolManager), uint256(uint128(-a1)));
            poolManager.settle();
        }
        if (a0 > 0) poolManager.take(k.currency0, address(this), uint256(uint128(a0)));
        if (a1 > 0) poolManager.take(k.currency1, address(this), uint256(uint128(a1)));
    }
}
