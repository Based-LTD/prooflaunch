// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4LegBase, ICampaignV2View, IFeeSplitterLegV2, IPonsV2CurveLeg} from "./V4LegBase.sol";
import {IPoolManagerMin, IV4StateView, PoolKey, V4ModifyLiquidityParams, V4Delta} from "./interfaces/IUniV4.sol";
import {IERC20} from "./interfaces/IPons.sol";

/// The construction-locked pool feeder (v3: one crank per block, tick
/// range derived from the pool's own spacing) — the leg
/// OWNS its full-range position on the pons graduated pool and has no
/// function that withdraws principal. Ever.
///
/// crank() (permissionless):
///   1. pull this leg's fee share from the splitter (native ETH + token)
///   2. during the curve phase, accumulate — v4 pool doesn't exist yet
///   3. after graduation: compound the position's own earned trading fees
///      (modifyLiquidity(0) credits them), then mint whatever balanced
///      full-range liquidity the balances allow; remainders carry forward
///
/// Full range for ANY spacing: ±((887272 / spacing) · spacing). At 200
/// that is ±887200. L = min(amt0·√P/Q96, amt1·Q96/√P).
contract FeedLPLegV3 is V4LegBase {
    using V4Delta for int256;

    uint256 private constant Q96 = 0x1000000000000000000000000;

    IV4StateView public immutable stateView;

    uint256 public totalLiquidityAdds;
    uint256 public totalEthDeployed;
    uint256 public totalTokensDeployed;

    /// One crank per block. The per-crank ETH cap only bounds extraction
    /// if it cannot be looped inside a single transaction; without this,
    /// a sandwicher who is also the cranker drains the whole balance 0.2
    /// ETH at a time in one tx. Cross-block bracketing on a 0.1 s L2 is
    /// still possible but pays the full round-trip each block.
    uint256 public lastCrankBlock;

    error CrankedThisBlock();

    event LiquidityFed(uint256 ethIn, uint256 tokensIn, uint128 liquidity);
    event Accumulating(uint256 ethHeld, uint256 tokensHeld); // curve phase

    constructor(address initializer_, IPoolManagerMin poolManager_, address memeHook_, IV4StateView stateView_)
        V4LegBase(initializer_, poolManager_, memeHook_)
    {
        stateView = stateView_;
    }

    /// Permissionless feed round.
    function crank() external {
        if (!campaign.launched()) revert NotLaunched();
        if (lastCrankBlock == block.number) revert CrankedThisBlock();
        lastCrankBlock = block.number;
        address token = campaign.token();
        _claimBoth(token);

        if (!IPonsV2CurveLeg(campaign.curve()).graduated()) {
            emit Accumulating(address(this).balance, IERC20(token).balanceOf(address(this)));
            return;
        }

        PoolKey memory k = _poolKey(token);
        bytes32 poolId = keccak256(abi.encode(k));

        // compound: pull the position's earned trading fees back into our
        // balances before sizing the next add
        if (totalLiquidityAdds > 0) {
            _unlock(abi.encode(uint8(1), token, uint256(0)));
        }

        (uint160 sqrtP,,,) = stateView.getSlot0(poolId);
        uint256 bal0 = address(this).balance;
        uint256 bal1 = IERC20(token).balanceOf(address(this));
        uint256 l0 = _mulDiv(bal0, sqrtP, Q96);
        uint256 l1 = _mulDiv(bal1, Q96, sqrtP);
        uint256 liq = l0 < l1 ? l0 : l1;
        if (liq == 0 || liq > type(uint128).max) {
            emit LiquidityFed(0, 0, 0);
            return; // nothing usable yet — balances carry forward
        }

        uint256 ethBefore = address(this).balance;
        uint256 tokBefore = IERC20(token).balanceOf(address(this));
        _unlock(abi.encode(uint8(2), token, liq));
        totalEthDeployed += ethBefore - address(this).balance;
        totalTokensDeployed += tokBefore - IERC20(token).balanceOf(address(this));
        totalLiquidityAdds += 1;
        emit LiquidityFed(ethBefore - address(this).balance, tokBefore - IERC20(token).balanceOf(address(this)), uint128(liq));
    }

    function _handleUnlock(bytes calldata data) internal override returns (bytes memory) {
        (uint8 mode, address token, uint256 liq) = abi.decode(data, (uint8, address, uint256));
        PoolKey memory k = _poolKey(token);
        (int256 callerDelta, ) = poolManager.modifyLiquidity(
            k,
            V4ModifyLiquidityParams({
                tickLower: -_maxTick(k.tickSpacing),
                tickUpper: _maxTick(k.tickSpacing),
                liquidityDelta: mode == 1 ? int256(0) : int256(liq),
                salt: bytes32(0)
            }),
            ""
        );
        _settleDelta(k, callerDelta);
        return "";
    }

    /// Widest tick usable at this spacing. Hardcoding ±887200 (spacing
    /// 200) meant any pons spacing change made every unlock revert forever
    /// with the leg's funds inside — an ownerless contract with no exit.
    function _maxTick(int24 spacing) internal pure returns (int24) {
        return (887272 / spacing) * spacing;
    }

    /// OpenZeppelin-style 512-bit mulDiv (floor), vendored.
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
