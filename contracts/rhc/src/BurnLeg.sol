// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IPons.sol";

interface ICampaignView {
    function token() external view returns (address);
    function launched() external view returns (bool);
}

interface IFeeSplitterLeg {
    function claimLeg(address asset) external;
}

interface IUniV3FactoryMin {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface IUniV3PoolMin {
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external returns (int256 amount0, int256 amount1);
    function token0() external view returns (address);
    function token1() external view returns (address);
}

/// The SOL burn bot, reborn as an ownerless contract. Receives its
/// basis-point leg of creator fees from the campaign's FeeSplitter and
/// permanently destroys supply:
///   - token-side fees  → sent straight to the dead address
///   - WETH-side fees   → market-buy the token on its pons v3 pool, then
///                        send the purchase to the dead address
///
/// crank() is permissionless — anyone may trigger a burn round; nothing
/// depends on prooflaunch infrastructure. Per-crank WETH is capped to keep
/// sandwich extraction on the public crank negligible; large accumulations
/// just take several cranks.
contract BurnLeg {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_WETH_PER_CRANK = 0.2 ether;
    uint160 private constant MIN_SQRT = 4295128740;
    uint160 private constant MAX_SQRT = 1461446703485210103287273052203988822378723970341;

    address public immutable factory; // CampaignFactory, may init() once
    address public immutable weth;
    IUniV3FactoryMin public immutable v3Factory;
    uint24 public immutable poolFee;

    ICampaignView public campaign;
    IFeeSplitterLeg public splitter;

    uint256 public totalWethSpent;
    uint256 public totalTokensBurned;

    address private _pendingPool; // callback auth for the in-flight swap

    event Burned(uint256 wethIn, uint256 tokensBurned);

    error AlreadyInit();
    error OnlyFactory();
    error NotLaunched();
    error NoPool();
    error BadCallback();

    constructor(address weth_, IUniV3FactoryMin v3Factory_, uint24 poolFee_) {
        factory = msg.sender;
        weth = weth_;
        v3Factory = v3Factory_;
        poolFee = poolFee_;
    }

    /// Wired once by the factory right after the Campaign (and its
    /// splitter) exist — the deploy order makes a constructor circular.
    function init(ICampaignView campaign_, IFeeSplitterLeg splitter_) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (address(campaign) != address(0)) revert AlreadyInit();
        campaign = campaign_;
        splitter = splitter_;
    }

    /// Permissionless burn round.
    function crank() external {
        if (!campaign.launched()) revert NotLaunched();
        address token = campaign.token();

        // Pull whatever this leg is owed, both assets. "Nothing to claim"
        // reverts are fine — we may still hold balance from prior pulls.
        try splitter.claimLeg(weth) {} catch {}
        try splitter.claimLeg(token) {} catch {}

        uint256 burnedNow = 0;

        // token-side fees burn directly
        uint256 tb = IERC20(token).balanceOf(address(this));
        if (tb > 0) {
            IERC20(token).transfer(DEAD, tb);
            burnedNow += tb;
        }

        // WETH-side fees buy-and-burn, capped per crank
        uint256 wb = IERC20(weth).balanceOf(address(this));
        uint256 amt = wb > MAX_WETH_PER_CRANK ? MAX_WETH_PER_CRANK : wb;
        if (amt > 0) {
            address pool = v3Factory.getPool(token, weth, poolFee);
            if (pool == address(0)) revert NoPool();
            bool zeroForOne = IUniV3PoolMin(pool).token0() == weth;
            _pendingPool = pool;
            IUniV3PoolMin(pool).swap(
                address(this), zeroForOne, int256(amt),
                zeroForOne ? MIN_SQRT + 1 : MAX_SQRT - 1, ""
            );
            _pendingPool = address(0);
            totalWethSpent += amt;
            uint256 bought = IERC20(token).balanceOf(address(this));
            if (bought > 0) {
                IERC20(token).transfer(DEAD, bought);
                burnedNow += bought;
            }
        }

        totalTokensBurned += burnedNow;
        emit Burned(amt, burnedNow);
    }

    // v3 pools call this to collect payment for the in-flight swap.
    function uniswapV3SwapCallback(int256 d0, int256 d1, bytes calldata) external {
        if (msg.sender != _pendingPool || _pendingPool == address(0)) revert BadCallback();
        if (d0 > 0) IERC20(IUniV3PoolMin(msg.sender).token0()).transfer(msg.sender, uint256(d0));
        if (d1 > 0) IERC20(IUniV3PoolMin(msg.sender).token1()).transfer(msg.sender, uint256(d1));
    }
}
