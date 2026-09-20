// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IPons.sol";
import {PoolKey} from "./interfaces/IUniV4.sol";
import {IEquityRouter} from "./interfaces/IEquityRouter.sol";

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
///   - ETH-only rewards accounting, and ETH-only intake: pokeClaim refuses
///     any other asset, because nothing can move a token OUT of this
///     ownerless contract. ERC20 legs (campaign tokens, ERC20-quoted
///     raises) stay owed in their splitters until a vault generation that
///     accounts them is pointed at by a factory redeploy.
contract RewardsVault {
    uint256 private constant PRECISION = 1e27;

    IERC20Pull public immutable stakeToken;

    /// Fixed at construction so this vault can only ever send your ETH to
    /// you or through this one router — a router address the caller could
    /// supply would just be a way to hand your claim to a stranger.
    /// claim() never touches it, so a broken router can delay a stock
    /// payout but can never trap a claim: plain ETH is always available.
    IEquityRouter public immutable equityRouter;

    uint256 public totalStaked;
    uint256 public accRewardPerShare; // scaled by PRECISION
    uint256 public accountedEth;      // portion of balance already folded in

    mapping(address => uint256) public stakedOf;
    mapping(address => uint256) public rewardDebt; // staked * acc / P at last sync
    mapping(address => uint256) public pendingOf;  // banked, unclaimed rewards

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event Claimed(address indexed user, uint256 ethAmount);
    event ClaimedAs(address indexed user, address indexed asset, uint256 ethIn, uint256 assetOut);
    event Distributed(uint256 ethAmount, uint256 totalStaked);

    error ZeroAmount();
    error Insufficient();
    error EthSend();
    error Reentrancy();
    error NoRouter();
    error NativeOnly();

    uint256 private _lock = 1;
    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IERC20Pull stakeToken_, IEquityRouter equityRouter_) {
        stakeToken = stakeToken_;
        equityRouter = equityRouter_;
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

    /// Settle the caller's position and zero out what they're owed. The
    /// ONE place a claim is accounted, so claim() and claimAs() can never
    /// drift apart. Effects only — the caller does the interaction.
    function _takeOwed() internal returns (uint256 owed) {
        distribute();
        _sync(msg.sender);
        owed = pendingOf[msg.sender];
        if (owed == 0) revert ZeroAmount();
        pendingOf[msg.sender] = 0;
        accountedEth -= owed;
    }

    function claim() external nonReentrant {
        uint256 owed = _takeOwed();
        emit Claimed(msg.sender, owed);
        (bool ok, ) = msg.sender.call{value: owed}("");
        if (!ok) revert EthSend();
    }

    /// Same claim, different asset in your wallet. The vault still only
    /// ever owes ETH — this routes YOUR entitlement through a v4 swap in
    /// the same transaction, and the asset is taken straight to you and
    /// never custodied here.
    ///
    /// `key` and `minOut` are the caller's: we hold no list of blessed
    /// assets, so anything with an ETH-paired v4 pool works the day it
    /// exists, and a bad pool costs the caller only what their own minOut
    /// permits. Reverting is the correct outcome for a pool that can't
    /// fill — nothing is claimed and they can call claim() instead.
    function claimAs(PoolKey calldata key, uint256 minOut)
        external
        nonReentrant
        returns (uint256 assetOut)
    {
        if (address(equityRouter) == address(0)) revert NoRouter();
        uint256 owed = _takeOwed();

        uint256 balBefore = address(this).balance;
        assetOut = equityRouter.routeEthTo{value: owed}(key, minOut, msg.sender, "");

        // The router refunds unspent native to its caller — that's us, and
        // it belongs to the claimer, not the staking pool. Clamped to what
        // we actually sent so a coincident inbound payment can't be walked
        // out as "refund".
        uint256 back = address(this).balance + owed - balBefore;
        if (back > owed) back = owed;
        if (back > 0) {
            (bool ok, ) = msg.sender.call{value: back}("");
            if (!ok) revert EthSend();
        }

        emit ClaimedAs(msg.sender, key.currency1, owed - back, assetOut);
    }

    // ── cranks + views ───────────────────────────────────────────────

    /// Pull this vault's holder-rewards leg from a campaign splitter.
    /// Permissionless; "nothing to claim" reverts are tolerated so bots
    /// can spray it across every splitter.
    function pokeClaim(ISplitterLegPull splitter, address asset) external {
        // v1 accounts native only. Pulling an ERC20 in here would trap it:
        // no function can move a token out of this ownerless contract. So
        // refuse, and leave ERC20 legs owed in the splitter for a vault
        // generation that can account them (a factory redeploy repoints).
        if (asset != address(0)) revert NativeOnly();
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
