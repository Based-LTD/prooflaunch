// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IPons.sol";

interface ICampaignShares {
    function contributionOf(address backer) external view returns (uint256);
    function totalRaisedAtLaunch() external view returns (uint256);
    function launched() external view returns (bool);
}

/// Receives the token's creator-fee share from the pons locker (WETH + the
/// launched token — v3 fees accrue in BOTH pool assets) and splits it by
/// immutable basis points:
///
///   - the backer pool (pro-rata to launch-time contributions, read live from
///     the Campaign — no duplicated share table to drift)
///   - fixed legs (platform, $PROOF holder rewards, future bot modules)
///
/// Everything is PULL-based. distribute() is a permissionless crank that only
/// does internal accounting; no external recipient can grief it by reverting,
/// and no operator has to be alive for anyone to get paid. There is no owner,
/// no admin, and no way to change the split after deployment.
contract FeeSplitter {
    ICampaignShares public immutable campaign;
    uint16 public immutable backerBps; // out of 10_000
    address[] public legRecipients;
    uint16[] public legBps;

    // cumulative amounts allocated to the backer pool, per asset
    // (asset address(0) = native ETH)
    mapping(address => uint256) public backerPool;
    // per-leg allocated-but-unclaimed balances: leg => asset => amount
    mapping(address => mapping(address => uint256)) public legOwed;
    // per-backer cumulative claims from the backer pool: backer => asset
    mapping(address => mapping(address => uint256)) public backerClaimed;
    // total balance already accounted for, per asset (so distribute() only
    // touches the delta since last crank)
    mapping(address => uint256) public accounted;

    error NotLaunched();
    error NothingToClaim();
    error LengthMismatch();
    error BpsSum();
    error EthSend();

    constructor(
        address campaign_,
        uint16 backerBps_,
        address[] memory legRecipients_,
        uint16[] memory legBps_
    ) {
        if (legRecipients_.length != legBps_.length) revert LengthMismatch();
        uint256 sum = backerBps_;
        for (uint256 i = 0; i < legBps_.length; i++) sum += legBps_[i];
        if (sum != 10_000) revert BpsSum();
        campaign = ICampaignShares(campaign_);
        backerBps = backerBps_;
        legRecipients = legRecipients_;
        legBps = legBps_;
    }

    receive() external payable {}

    /// pons sends the launch-time initial-buy tokens to the feeWallet (this
    /// contract), not to the launch caller — discovered by fork test, see
    /// spec §8. The Campaign calls this ONCE, inside the same transaction as
    /// launchToken(), to move the launch allocation home before any fees can
    /// have accrued. Campaign-only; safe to call repeatedly (drains balance).
    function drainTo(address to, address asset) external {
        if (msg.sender != address(campaign)) revert NotLaunched();
        uint256 bal = asset == address(0)
            ? address(this).balance
            : IERC20(asset).balanceOf(address(this));
        uint256 unaccounted = bal - accounted[asset];
        if (unaccounted == 0) return;
        if (asset == address(0)) {
            (bool ok, ) = to.call{value: unaccounted}("");
            if (!ok) revert EthSend();
        } else {
            if (!IERC20(asset).transfer(to, unaccounted)) revert EthSend();
        }
    }

    /// Permissionless. Allocates any un-accounted balance of `asset` to the
    /// backer pool and the legs. address(0) = native ETH.
    function distribute(address asset) public {
        uint256 bal = asset == address(0)
            ? address(this).balance
            : IERC20(asset).balanceOf(address(this));
        uint256 delta = bal - accounted[asset];
        if (delta == 0) return;
        accounted[asset] = bal;

        uint256 toBackers = (delta * backerBps) / 10_000;
        backerPool[asset] += toBackers;
        uint256 allocated = toBackers;
        for (uint256 i = 0; i < legRecipients.length; i++) {
            uint256 amt = (delta * legBps[i]) / 10_000;
            // last leg absorbs rounding dust so nothing is stranded
            if (i == legRecipients.length - 1) amt = delta - allocated;
            else allocated += amt;
            legOwed[legRecipients[i]][asset] += amt;
        }
    }

    /// A backer's lifetime entitlement from the backer pool for `asset`.
    function backerEntitlement(address backer, address asset) public view returns (uint256) {
        uint256 total = campaign.totalRaisedAtLaunch();
        if (total == 0) return 0;
        return (backerPool[asset] * campaign.contributionOf(backer)) / total;
    }

    /// Pull a backer's outstanding share of `asset`. Anyone can crank
    /// distribute() first; claim does it implicitly for freshness.
    function claimBacker(address asset) external {
        if (!campaign.launched()) revert NotLaunched();
        distribute(asset);
        uint256 owed = backerEntitlement(msg.sender, asset) - backerClaimed[msg.sender][asset];
        if (owed == 0) revert NothingToClaim();
        backerClaimed[msg.sender][asset] += owed;
        _pay(msg.sender, asset, owed);
    }

    /// Pull a leg's outstanding balance of `asset` (platform, holder rewards…).
    function claimLeg(address asset) external {
        distribute(asset);
        uint256 owed = legOwed[msg.sender][asset];
        if (owed == 0) revert NothingToClaim();
        legOwed[msg.sender][asset] = 0;
        _pay(msg.sender, asset, owed);
    }

    function _pay(address to, address asset, uint256 amount) internal {
        // effects above, interaction last; accounted must shrink with balance
        accounted[asset] -= amount;
        if (asset == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert EthSend();
        } else {
            if (!IERC20(asset).transfer(to, amount)) revert EthSend();
        }
    }

    function legCount() external view returns (uint256) {
        return legRecipients.length;
    }
}
