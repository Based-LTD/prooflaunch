// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {V4LegBase, ICampaignV2View, IFeeSplitterLegV2, IPonsV2CurveLeg} from "./V4LegBase.sol";
import {IPoolManagerMin, PoolKey, V4SwapParams, V4Delta} from "./interfaces/IUniV4.sol";
import {IERC20} from "./interfaces/IPons.sol";

/// The trustless buy-and-burn bot, ported to pons V2. Dual-phase:
///
///   curve phase  — fee ETH market-buys the token directly on the pons
///                  bonding curve (public buy(), native quote)
///   v4 phase     — after graduation, the leg swaps on the Uniswap v4
///                  pool via the PoolManager directly (unlock/callback,
///                  no router) — proven third-party-allowed on fork
///
/// Either way the purchase — and any token-side fees — goes to the dead
/// address. No owner, no operator, no off switch: anyone may crank,
/// nobody can stop it. Per-crank ETH is capped so sandwiching the public
/// crank stays negligible; big accumulations just take several cranks.
contract BurnLegV2 is V4LegBase {
    using V4Delta for int256;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_ETH_PER_CRANK = 0.2 ether;

    uint256 public totalEthSpent;
    uint256 public totalTokensBurned;

    event Burned(uint256 ethIn, uint256 tokensBurned, bool viaCurve);

    constructor(address initializer_, IPoolManagerMin poolManager_, address memeHook_)
        V4LegBase(initializer_, poolManager_, memeHook_) {}

    /// Permissionless burn round.
    function crank() external {
        if (!campaign.launched()) revert NotLaunched();
        address token = campaign.token();
        _claimBoth(token);

        uint256 burnedNow = 0;

        // token-side fees burn directly
        uint256 tb = IERC20(token).balanceOf(address(this));
        if (tb > 0) {
            IERC20(token).transfer(DEAD, tb);
            burnedNow += tb;
        }

        // ETH-side fees buy-and-burn, capped per crank
        uint256 eb = address(this).balance;
        uint256 amt = eb > MAX_ETH_PER_CRANK ? MAX_ETH_PER_CRANK : eb;
        bool viaCurve = false;
        if (amt > 0) {
            IPonsV2CurveLeg curve = IPonsV2CurveLeg(campaign.curve());
            if (!curve.graduated()) {
                // curve buy is atomic with the crank; the launch-window
                // snipe tax is long gone by the time fees exist
                viaCurve = true;
                curve.buy{value: amt}(amt, 0, address(this));
            } else {
                _unlock(abi.encode(token, amt));
            }
            totalEthSpent += amt;
            uint256 bought = IERC20(token).balanceOf(address(this));
            if (bought > 0) {
                IERC20(token).transfer(DEAD, bought);
                burnedNow += bought;
            }
        }

        totalTokensBurned += burnedNow;
        emit Burned(amt, burnedNow, viaCurve);
    }

    function _handleUnlock(bytes calldata data) internal override returns (bytes memory) {
        (address token, uint256 ethIn) = abi.decode(data, (address, uint256));
        PoolKey memory k = _poolKey(token);
        int256 delta = poolManager.swap(
            k,
            V4SwapParams({zeroForOne: true, amountSpecified: -int256(ethIn), sqrtPriceLimitX96: MIN_SQRT}),
            ""
        );
        _settleDelta(k, delta);
        return "";
    }
}
