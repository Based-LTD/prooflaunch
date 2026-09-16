// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IPons.sol";

interface IERC20Pull {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface ISplitterLegPull {
    function claimLeg(address asset) external;
}

/// The platform token's holder-rewards engine — the SOL staking design
/// ([[proof-staking-design]]) rebuilt as an ownerless contract.
///
/// Every campaign's 3% holder-rewards leg pays this vault in native ETH;
/// stakers of the platform token split the stream pro-rata, continuously.
/// Synthetix-style accumulator: no snapshots, no distribution days, no
/// operator. Stake, and your share of every future wei is yours to pull.
///
/// Design rules (same constitution as everything else here):
///   - no owner, no pause, no upgrade; stake token fixed at construction
///   - pull-based everywhere; pokeClaim() is a permissionless crank that
///     pulls this vault's leg from any campaign splitter
///   - ETH-only rewards accounting. Token-side leg fees (campaign tokens)
///     can be pulled in and sit here inert — never lost (this vault holds
///     them; a future vault generation can be pointed at by new factories,
///     and stakers migrate by unstaking) but v1 pays ETH only.
contract RewardsVault {
    uint256 private constant PRECISION = 1e27;

    IERC20Pull public immutable stakeToken;

    uint256 public totalStaked;
    uint256 public accRewardPerShare; // scaled by PRECISION
    uint256 public accountedEth;      // portion of balance already folded in

    mapping(address => uint256) public stakedOf;
    mapping(address => uint256) public rewardDebt; // staked * acc / P at last sync
    mapping(address => uint256) public pendingOf;  // banked, unclaimed rewards

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 ethAmount);
    event Distributed(uint256 ethAmount, uint256 totalStaked);

    error ZeroAmount();
    error Insufficient();
    error EthSend();
    error Reentrancy();

    uint256 private _lock = 1;
    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IERC20Pull stakeToken_) {
        stakeToken = stakeToken_;
    }

    /// ETH arrives from splitter legs (and anyone else who wants to pay
    /// stakers — donations simply join the stream).
    receive() external payable {}

    // ── accounting ───────────────────────────────────────────────────

    /// Fold any un-accounted ETH into the accumulator. Permissionless.
    /// While nobody is staked, ETH waits un-accounted (nothing is ever
    /// attributed to an empty pool) and the first stakers inherit it.
    function distribute() public {
        if (totalStaked == 0) return;
        // accountedEth is exactly the ETH already promised (banked pending
        // + accumulator entitlements, net of claims) — anything above it
        // is new revenue.
        uint256 delta = address(this).balance - accountedEth;
        if (delta == 0) return;
        accountedEth += delta;
        accRewardPerShare += (delta * PRECISION) / totalStaked;
        emit Distributed(delta, totalStaked);
    }

    function _sync(address user) internal {
        uint256 staked = stakedOf[user];
        if (staked > 0) {
            uint256 owed = (staked * accRewardPerShare) / PRECISION - rewardDebt[user];
            if (owed > 0) pendingOf[user] += owed;
        }
        rewardDebt[user] = (stakedOf[user] * accRewardPerShare) / PRECISION;
    }

    // ── staking ──────────────────────────────────────────────────────

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        distribute();
        _sync(msg.sender);
        if (!stakeToken.transferFrom(msg.sender, address(this), amount)) revert Insufficient();
        stakedOf[msg.sender] += amount;
        totalStaked += amount;
        rewardDebt[msg.sender] = (stakedOf[msg.sender] * accRewardPerShare) / PRECISION;
        emit Staked(msg.sender, amount);
    }

    function unstake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (stakedOf[msg.sender] < amount) revert Insufficient();
        distribute();
        _sync(msg.sender);
        stakedOf[msg.sender] -= amount;
        totalStaked -= amount;
        rewardDebt[msg.sender] = (stakedOf[msg.sender] * accRewardPerShare) / PRECISION;
        if (!stakeToken.transfer(msg.sender, amount)) revert EthSend();
        emit Unstaked(msg.sender, amount);
    }

    function claim() external nonReentrant {
        distribute();
        _sync(msg.sender);
        uint256 owed = pendingOf[msg.sender];
        if (owed == 0) revert ZeroAmount();
        pendingOf[msg.sender] = 0;
        accountedEth -= owed;
        emit Claimed(msg.sender, owed);
        (bool ok, ) = msg.sender.call{value: owed}("");
        if (!ok) revert EthSend();
    }

    // ── cranks + views ───────────────────────────────────────────────

    /// Pull this vault's holder-rewards leg from a campaign splitter.
    /// Permissionless; "nothing to claim" reverts are tolerated so bots
    /// can spray it across every splitter.
    function pokeClaim(ISplitterLegPull splitter, address asset) external {
        try splitter.claimLeg(asset) {} catch {}
        distribute();
    }

    function earned(address user) external view returns (uint256) {
        uint256 acc = accRewardPerShare;
        if (totalStaked > 0) {
            uint256 delta = address(this).balance - accountedEth;
            acc += (delta * PRECISION) / totalStaked;
        }
        return pendingOf[user] + (stakedOf[user] * acc) / PRECISION - rewardDebt[user];
    }
}
