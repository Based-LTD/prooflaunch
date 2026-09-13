// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IPons.sol";
import {ICampaignView, IFeeSplitterLeg, IUniV3FactoryMin} from "./BurnLeg.sol";

interface IUniV3PoolLP {
    function slot0() external view returns (
        uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool
    );
    function token0() external view returns (address);
    function mint(address recipient, int24 tickLower, int24 tickUpper, uint128 amount, bytes calldata data)
        external returns (uint256 amount0, uint256 amount1);
    function burn(int24 tickLower, int24 tickUpper, uint128 amount)
        external returns (uint256 amount0, uint256 amount1);
    function collect(address recipient, int24 tickLower, int24 tickUpper, uint128 amount0Requested, uint128 amount1Requested)
        external returns (uint128 amount0, uint128 amount1);
}

/// The SOL pool-feeder bot, reborn as an ownerless contract — and the
/// liquidity it deploys is LOCKED BY CONSTRUCTION: this contract owns the
/// position and has no function that withdraws principal. Ever.
///
/// crank() (permissionless):
///   1. pull this leg's fee share from the splitter (WETH + token)
///   2. sweep the position's own earned trading fees back in (compound)
///   3. mint full-range liquidity into the token's pons v3 pool with
///      whatever balanced amount the balances allow; remainders carry
///      to the next crank
///
/// Full-range keeps the math honest and the position rug-proof-simple:
/// L = min(amount0·√P/Q96, amount1·Q96/√P).
contract FeedLPLeg {
    // fee tier 10000 → tickSpacing 200; full range rounded to spacing
    int24 public constant TICK_LOWER = -887200;
    int24 public constant TICK_UPPER = 887200;
    uint256 private constant Q96 = 0x1000000000000000000000000;

    address public immutable initializer; // CampaignFactory, may init() once
    address public immutable weth;
    IUniV3FactoryMin public immutable v3Factory;
    uint24 public immutable poolFee;

    ICampaignView public campaign;
    IFeeSplitterLeg public splitter;

    uint256 public totalLiquidityAdds;
    uint256 public totalWethDeployed;
    uint256 public totalTokensDeployed;

    address private _pendingPool;

    event LiquidityFed(uint256 wethIn, uint256 tokensIn, uint128 liquidity);

    error AlreadyInit();
    error OnlyFactory();
    error NotLaunched();
    error NoPool();
    error BadCallback();

    constructor(address initializer_, address weth_, IUniV3FactoryMin v3Factory_, uint24 poolFee_) {
        initializer = initializer_;
        weth = weth_;
        v3Factory = v3Factory_;
        poolFee = poolFee_;
    }

    function init(ICampaignView campaign_, IFeeSplitterLeg splitter_) external {
        if (msg.sender != initializer) revert OnlyFactory();
        if (address(campaign) != address(0)) revert AlreadyInit();
        campaign = campaign_;
        splitter = splitter_;
    }

    /// Permissionless feed round.
    function crank() external {
        if (!campaign.launched()) revert NotLaunched();
        address token = campaign.token();
        address pool = v3Factory.getPool(token, weth, poolFee);
        if (pool == address(0)) revert NoPool();

        // 1. pull our fee legs (nothing-to-claim reverts are fine)
        try splitter.claimLeg(weth) {} catch {}
        try splitter.claimLeg(token) {} catch {}

        // 2. compound: sweep the position's earned trading fees back in
        if (totalLiquidityAdds > 0) {
            IUniV3PoolLP(pool).burn(TICK_LOWER, TICK_UPPER, 0);
            IUniV3PoolLP(pool).collect(
                address(this), TICK_LOWER, TICK_UPPER,
                type(uint128).max, type(uint128).max
            );
        }

        // 3. mint whatever balanced full-range liquidity our balances allow
        (uint160 sqrtP,,,,,,) = IUniV3PoolLP(pool).slot0();
        bool wethIs0 = IUniV3PoolLP(pool).token0() == weth;
        uint256 bal0 = IERC20(wethIs0 ? weth : token).balanceOf(address(this));
        uint256 bal1 = IERC20(wethIs0 ? token : weth).balanceOf(address(this));
        // full-range: L0 = amount0·√P/Q96, L1 = amount1·Q96/√P
        uint256 l0 = _mulDiv(bal0, sqrtP, Q96);
        uint256 l1 = _mulDiv(bal1, Q96, sqrtP);
        uint256 liq = l0 < l1 ? l0 : l1;
        if (liq == 0 || liq > type(uint128).max) {
            emit LiquidityFed(0, 0, 0);
            return; // nothing usable yet — balances carry forward
        }

        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        uint256 tokenBefore = IERC20(token).balanceOf(address(this));
        _pendingPool = pool;
        IUniV3PoolLP(pool).mint(address(this), TICK_LOWER, TICK_UPPER, uint128(liq), "");
        _pendingPool = address(0);

        uint256 wethUsed = wethBefore - IERC20(weth).balanceOf(address(this));
        uint256 tokenUsed = tokenBefore - IERC20(token).balanceOf(address(this));
        totalWethDeployed += wethUsed;
        totalTokensDeployed += tokenUsed;
        totalLiquidityAdds += 1;
        emit LiquidityFed(wethUsed, tokenUsed, uint128(liq));
    }

    // pool calls this to collect payment for the in-flight mint
    function uniswapV3MintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata) external {
        if (msg.sender != _pendingPool || _pendingPool == address(0)) revert BadCallback();
        if (amount0Owed > 0) IERC20(IUniV3PoolLP(msg.sender).token0()).transfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) {
            address t1 = IUniV3PoolLP(msg.sender).token0() == weth ? campaign.token() : weth;
            IERC20(t1).transfer(msg.sender, amount1Owed);
        }
    }

    /// OpenZeppelin-style 512-bit mulDiv (floor). Vendored to stay
    /// dependency-free.
    function _mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            uint256 prod0; uint256 prod1;
            assembly {
                let mm := mulmod(a, b, not(0))
                prod0 := mul(a, b)
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }
            if (prod1 == 0) return prod0 / denominator;
            require(denominator > prod1, "mulDiv overflow");
            uint256 remainder;
            assembly {
                remainder := mulmod(a, b, denominator)
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }
            uint256 twos = denominator & (~denominator + 1);
            assembly {
                denominator := div(denominator, twos)
                prod0 := div(prod0, twos)
                twos := add(div(sub(0, twos), twos), 1)
            }
            prod0 |= prod1 * twos;
            uint256 inverse = (3 * denominator) ^ 2;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            inverse *= 2 - denominator * inverse;
            result = prod0 * inverse;
        }
    }
}
