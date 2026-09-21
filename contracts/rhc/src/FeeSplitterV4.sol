// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IPons.sol";
import {IPonsV2FeeEscrow} from "./interfaces/IPonsV2.sol";
import {IEquityRouter} from "./interfaces/IEquityRouter.sol";
import {PoolKey} from "./interfaces/IUniV4.sol";

interface ICampaignHoldView {
    function contributionOf(address backer) external view returns (uint256);
    function totalRaisedAtLaunch() external view returns (uint256);
    function tokensAtLaunch() external view returns (uint256);
    function tokensClaimed(address backer) external view returns (bool);
    function launched() external view returns (bool);
    function token() external view returns (address);
    function quoteToken() external view returns (address);
}

/// FeeSplitterV3 with one new rule: **the fee stream follows the tokens.**
///
/// V1–V3 paid a backer their launch-time share of the creator tax forever,
/// whether or not they still held the token. A wallet that sold in minute
/// one kept earning next to the wallets that stayed. This generation
/// weighs every claim by how much of the launch allocation the wallet
/// still holds, and hands the rest to the holder-rewards leg — the
/// platform token's stakers, once the vault is the leg recipient.
///
///   held   = min(balance, allocation) / allocation      (unclaimed = held)
///   kept   = freshEntitlement × held
///   lost   = freshEntitlement − kept   → legOwed[forfeitTo]
///
/// Entitlement is judged ONCE per unit — `backerSettled` records how much
/// of a backer's lifetime entitlement has already been split into kept and
/// lost, so a settle followed by a claim can never scale the same fees
/// twice. `settle(backer)` is a permissionless crank: anyone can lock in a
/// seller's forfeiture while they are out, which is what makes "buy back
/// just before claiming" a losing trade — the fees that accrued while they
/// were out are already gone. Fees judged while holding are banked and
/// stay theirs even if they sell afterwards: you earned those while in.
///
/// Known edges, stated up front: transferring the allocation to another
/// wallet reads as selling. Held = wallet balance + unclaimed (still in
/// the campaign, including a pre-launch lock) + staked in the rewards
/// vault when this token is the vault's stake token. Buying more than the allocation caps at 100% — it never pays
/// more than the launch-time share.
///
/// Everything else is FeeSplitterV3 verbatim in behaviour — per-asset
/// accounting, pull-based legs, the escrow harvest, and routed claims
/// through EquityRouter. Standalone (not inherited) so no deployed source
/// changes: the V3 claim paths are non-virtual and would bypass the rule.
/// No owner, no pause, no upgrade, no way to change the split.
contract FeeSplitterV4 {
    ICampaignHoldView public immutable campaign;
    IPonsV2FeeEscrow public immutable escrow;
    /// Platform-fixed at construction, never caller-supplied (see V3).
    IEquityRouter public immutable equityRouter;
    /// Where a seller's share goes: the holder-rewards leg recipient.
    address public immutable forfeitTo;
    uint16 public immutable backerBps; // out of 10_000
    address[] public legRecipients;
    uint16[] public legBps;

    mapping(address => uint256) public backerPool;                          // cumulative, per asset
    mapping(address => mapping(address => uint256)) public legOwed;         // leg => asset => unclaimed
    mapping(address => mapping(address => uint256)) public backerClaimed;   // backer => asset => lifetime PAID
    mapping(address => mapping(address => uint256)) public backerSettled;   // backer => asset => entitlement already judged
    mapping(address => mapping(address => uint256)) public backerBanked;    // backer => asset => judged-and-kept, unpaid
    mapping(address => uint256) public accounted;

    event Settled(address indexed backer, address indexed asset, uint256 kept, uint256 forfeited, uint16 heldBps);
    event BackerClaimed(address indexed backer, address indexed asset, uint256 amount);
    event ClaimedAs(address indexed who, address indexed asset, uint256 ethIn, uint256 assetOut, bool isLeg);

    error NotLaunched();
    error NothingToClaim();
    error LengthMismatch();
    error BpsSum();
    error EthSend();
    error NoRouter();
    error Reentrancy();
    error BadForfeit();

    uint256 private _lock = 1;
    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(
        address campaign_,
        IPonsV2FeeEscrow escrow_,
        uint16 backerBps_,
        address[] memory legRecipients_,
        uint16[] memory legBps_,
        IEquityRouter equityRouter_,
        address forfeitTo_
    ) {
        if (legRecipients_.length != legBps_.length) revert LengthMismatch();
        // A zero recipient would strand every forfeited wei: only address(0)
        // could claim it.
        if (forfeitTo_ == address(0)) revert BadForfeit();
        uint256 sum = backerBps_;
        for (uint256 i = 0; i < legBps_.length; i++) sum += legBps_[i];
        if (sum != 10_000) revert BpsSum();
        campaign = ICampaignHoldView(campaign_);
        escrow = escrow_;
        backerBps = backerBps_;
        legRecipients = legRecipients_;
        legBps = legBps_;
        equityRouter = equityRouter_;
        forfeitTo = forfeitTo_;
    }

    receive() external payable {}

    // ── the rule ─────────────────────────────────────────────────────

    /// How much of its launch allocation a backer still holds, in bps.
    /// Tokens not yet claimed sit in the campaign contract — fully held.
    function heldBps(address backer) public view returns (uint16) {
        if (!campaign.tokensClaimed(backer)) return 10_000;
        uint256 total = campaign.totalRaisedAtLaunch();
        if (total == 0) return 10_000;
        uint256 alloc = (campaign.tokensAtLaunch() * campaign.contributionOf(backer)) / total;
        if (alloc == 0) return 10_000;
        address t = campaign.token();
        uint256 bal = IERC20(t).balanceOf(backer) + _stakedInVault(backer, t);
        if (bal >= alloc) return 10_000;
        return uint16((bal * 10_000) / alloc);
    }

    /// Tokens staked in the rewards vault are held, not sold — but only
    /// when THIS campaign's token is the vault's stake token (the platform
    /// token's own raise). The vault is the forfeit recipient; on older
    /// factories that address is an EOA, so this is a raw staticcall that
    /// answers zero for anything that isn't a vault. Views only.
    function _stakedInVault(address backer, address t) internal view returns (uint256) {
        (bool ok, bytes memory d) = forfeitTo.staticcall(abi.encodeWithSignature("stakeToken()"));
        if (!ok || d.length < 32 || abi.decode(d, (address)) != t) return 0;
        (ok, d) = forfeitTo.staticcall(abi.encodeWithSignature("stakedOf(address)", backer));
        if (!ok || d.length < 32) return 0;
        return abi.decode(d, (uint256));
    }

    /// A backer's lifetime entitlement from the backer pool for `asset` —
    /// the launch-time share, before the hold rule. Same as V1–V3.
    function backerEntitlement(address backer, address asset) public view returns (uint256) {
        uint256 total = campaign.totalRaisedAtLaunch();
        if (total == 0) return 0;
        return (backerPool[asset] * campaign.contributionOf(backer)) / total;
    }

    /// What a claim would pay right now: banked + the unjudged remainder at
    /// the current hold. The UI's number. Does not include un-distributed
    /// balance — call distribute() (or read it as pending) for that.
    function backerOwed(address backer, address asset) external view returns (uint256) {
        uint256 fresh = backerEntitlement(backer, asset) - backerSettled[backer][asset];
        return backerBanked[backer][asset] + (fresh * heldBps(backer)) / 10_000;
    }

    /// Judge the not-yet-judged entitlement at the current hold. Returns
    /// what the backer keeps; the rest is now the holder-rewards leg's.
    function _settle(address backer, address asset) internal returns (uint256 kept, uint256 fresh) {
        fresh = backerEntitlement(backer, asset) - backerSettled[backer][asset];
        if (fresh == 0) return (0, 0);
        backerSettled[backer][asset] += fresh;
        uint16 h = heldBps(backer);
        kept = (fresh * h) / 10_000;
        uint256 lost = fresh - kept;
        if (lost > 0) legOwed[forfeitTo][asset] += lost;
        emit Settled(backer, asset, kept, lost, h);
    }

    /// Permissionless crank: lock in a backer's hold-weighted split now.
    /// The kept part is banked for them; the forfeited part is gone. Call
    /// it on a wallet that sold, and the fees that accrued while it was out
    /// can never be recovered by buying back before a claim.
    function settle(address backer, address asset) external nonReentrant {
        if (!campaign.launched()) revert NotLaunched();
        distribute(asset);
        (uint256 kept, ) = _settle(backer, asset);
        if (kept > 0) backerBanked[backer][asset] += kept;
    }

    // ── accounting (V3 verbatim) ──────────────────────────────────────

    /// Campaign-only, launch-tx only: move the launch allocation home.
    function drainTo(address to, address asset) external {
        if (msg.sender != address(campaign)) revert NotLaunched();
        uint256 bal = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
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
        uint256 bal = asset == address(0) ? address(this).balance : IERC20(asset).balanceOf(address(this));
        uint256 delta = bal - accounted[asset];
        if (delta == 0) return;
        accounted[asset] = bal;
        uint256 toBackers = (delta * backerBps) / 10_000;
        backerPool[asset] += toBackers;
        uint256 allocated = toBackers;
        for (uint256 i = 0; i < legRecipients.length; i++) {
            uint256 amt = (delta * legBps[i]) / 10_000;
            if (i == legRecipients.length - 1) amt = delta - allocated; // dust absorber
            else allocated += amt;
            legOwed[legRecipients[i]][asset] += amt;
        }
    }

    // ── claims ───────────────────────────────────────────────────────

    /// Pull what the hold rule says is yours. A wallet that sold everything
    /// does NOT revert: its share is judged, forfeited and recorded, and the
    /// call pays nothing — the receipt says where the fees went.
    function claimBacker(address asset) external nonReentrant returns (uint256 paid) {
        if (!campaign.launched()) revert NotLaunched();
        distribute(asset);
        (uint256 kept, uint256 fresh) = _settle(msg.sender, asset);
        paid = backerBanked[msg.sender][asset] + kept;
        if (paid == 0 && fresh == 0) revert NothingToClaim();
        backerBanked[msg.sender][asset] = 0;
        if (paid > 0) {
            backerClaimed[msg.sender][asset] += paid;
            emit BackerClaimed(msg.sender, asset, paid);
            _pay(msg.sender, asset, paid);
        }
    }

    /// claimBacker(address(0)), but the ETH arrives as `key.currency1`.
    function claimBackerAs(PoolKey calldata key, uint256 minOut) external nonReentrant returns (uint256 out) {
        if (address(equityRouter) == address(0)) revert NoRouter();
        if (!campaign.launched()) revert NotLaunched();
        distribute(address(0));
        (uint256 kept, uint256 fresh) = _settle(msg.sender, address(0));
        uint256 paid = backerBanked[msg.sender][address(0)] + kept;
        if (paid == 0 && fresh == 0) revert NothingToClaim();
        backerBanked[msg.sender][address(0)] = 0;
        if (paid == 0) return 0; // judged and forfeited; nothing to route
        backerClaimed[msg.sender][address(0)] += paid;
        emit BackerClaimed(msg.sender, address(0), paid);
        out = _routeOut(key, minOut, paid, false);
    }

    /// Pull a leg's outstanding balance of `asset` (platform, holder
    /// rewards, bots…). Forfeited backer shares arrive here too.
    function claimLeg(address asset) external nonReentrant {
        distribute(asset);
        uint256 owed = legOwed[msg.sender][asset];
        if (owed == 0) revert NothingToClaim();
        legOwed[msg.sender][asset] = 0;
        _pay(msg.sender, asset, owed);
    }

    function claimLegAs(PoolKey calldata key, uint256 minOut) external nonReentrant returns (uint256 out) {
        if (address(equityRouter) == address(0)) revert NoRouter();
        distribute(address(0));
        uint256 owed = legOwed[msg.sender][address(0)];
        if (owed == 0) revert NothingToClaim();
        legOwed[msg.sender][address(0)] = 0;
        out = _routeOut(key, minOut, owed, true);
    }

    function _routeOut(PoolKey calldata key, uint256 minOut, uint256 owed, bool isLeg) internal returns (uint256 out) {
        accounted[address(0)] -= owed;
        uint256 balBefore = address(this).balance;
        out = equityRouter.routeEthTo{value: owed}(key, minOut, msg.sender, "");
        uint256 back = address(this).balance + owed - balBefore;
        if (back > owed) back = owed;
        if (back > 0) {
            (bool ok, ) = msg.sender.call{value: back}("");
            if (!ok) revert EthSend();
        }
        emit ClaimedAs(msg.sender, key.currency1, owed - back, out, isLeg);
    }

    function _pay(address to, address asset, uint256 amount) internal {
        accounted[asset] -= amount;
        if (asset == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert EthSend();
        } else {
            if (!IERC20(asset).transfer(to, amount)) revert EthSend();
        }
    }

    /// Pull everything the escrow owes us, then account. Permissionless.
    function harvest() external {
        uint256 owedEth = escrow.balanceOf(address(this));
        if (owedEth > 0) escrow.claim(owedEth);
        distribute(address(0));
        address t = campaign.token();
        if (t != address(0)) {
            uint256 owedTok = escrow.balanceOfToken(address(this), t);
            if (owedTok > 0) escrow.claimToken(t, owedTok);
            distribute(t);
        }
        address q = campaign.quoteToken();
        if (q != address(0)) {
            uint256 owedQ = escrow.balanceOfToken(address(this), q);
            if (owedQ > 0) escrow.claimToken(q, owedQ);
            distribute(q);
        }
    }

    function legCount() external view returns (uint256) {
        return legRecipients.length;
    }
}
