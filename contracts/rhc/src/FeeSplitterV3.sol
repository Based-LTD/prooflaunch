// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FeeSplitter} from "./FeeSplitter.sol";
import {IPonsV2FeeEscrow} from "./interfaces/IPonsV2.sol";
import {IEquityRouter} from "./interfaces/IEquityRouter.sol";
import {PoolKey} from "./interfaces/IUniV4.sol";

interface ICampaignAssetsView {
    function token() external view returns (address);
    function quoteToken() external view returns (address);
}

/// FeeSplitterV2's escrow-harvest, made quote-aware: an ERC20-quoted
/// campaign (USDG, tokenized stocks…) earns creator fees in the QUOTE
/// asset + the launched token; a native campaign earns ETH + token.
/// harvest() pulls whichever apply. The per-asset accounting underneath
/// is inherited unchanged — it never cared what the assets were.
contract FeeSplitterV3 is FeeSplitter {
    IPonsV2FeeEscrow public immutable escrow;

    /// Platform-fixed at construction (factory → campaign → here). Only the
    /// NATIVE entitlement can be routed: the splitter owes ETH, and the
    /// recipient chooses what lands in their wallet. Nothing here ever
    /// holds an equity; the asset is taken straight to the claimer.
    IEquityRouter public immutable equityRouter;

    event ClaimedAs(address indexed who, address indexed asset, uint256 ethIn, uint256 assetOut, bool isLeg);

    error NoRouter();
    error Reentrancy();

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
        IEquityRouter equityRouter_
    ) FeeSplitter(campaign_, backerBps_, legRecipients_, legBps_) {
        escrow = escrow_;
        equityRouter = equityRouter_;
    }

    /// claimBacker(address(0)), but the ETH arrives as `key.currency1`.
    /// Same accounting path as the plain claim — effects first, then one
    /// router call — so the two can never disagree about what was owed.
    /// A failed swap reverts the whole tx and the claim stays claimable.
    function claimBackerAs(PoolKey calldata key, uint256 minOut) external nonReentrant returns (uint256 out) {
        if (address(equityRouter) == address(0)) revert NoRouter();
        if (!campaign.launched()) revert NotLaunched();
        distribute(address(0));
        uint256 owed = backerEntitlement(msg.sender, address(0)) - backerClaimed[msg.sender][address(0)];
        if (owed == 0) revert NothingToClaim();
        backerClaimed[msg.sender][address(0)] += owed;
        out = _routeOut(key, minOut, owed, false);
    }

    /// claimLeg(address(0)) routed the same way — a named vault wallet or
    /// the platform can take its share as stock too.
    function claimLegAs(PoolKey calldata key, uint256 minOut) external nonReentrant returns (uint256 out) {
        if (address(equityRouter) == address(0)) revert NoRouter();
        distribute(address(0));
        uint256 owed = legOwed[msg.sender][address(0)];
        if (owed == 0) revert NothingToClaim();
        legOwed[msg.sender][address(0)] = 0;
        out = _routeOut(key, minOut, owed, true);
    }

    function _routeOut(PoolKey calldata key, uint256 minOut, uint256 owed, bool isLeg) internal returns (uint256 out) {
        accounted[address(0)] -= owed; // mirror _pay: accounted shrinks with balance
        uint256 balBefore = address(this).balance;
        out = equityRouter.routeEthTo{value: owed}(key, minOut, msg.sender, "");
        // The router refunds unspent native to its caller — us. It is the
        // claimer's, not the pool's: left here it would be re-distributed
        // to everyone on the next crank. Clamped to what we sent.
        uint256 back = address(this).balance + owed - balBefore;
        if (back > owed) back = owed;
        if (back > 0) {
            (bool ok, ) = msg.sender.call{value: back}("");
            if (!ok) revert EthSend();
        }
        emit ClaimedAs(msg.sender, key.currency1, owed - back, out, isLeg);
    }

    /// Pull everything the escrow owes us, then account. Permissionless.
    function harvest() external {
        // native side (pons pays launch-fee-adjacent flows in ETH even for
        // ERC20-quoted pools; claiming zero-cost when nothing is owed)
        uint256 owedEth = escrow.balanceOf(address(this));
        if (owedEth > 0) escrow.claim(owedEth);
        distribute(address(0));

        address t = ICampaignAssetsView(address(campaign)).token();
        if (t != address(0)) {
            uint256 owedTok = escrow.balanceOfToken(address(this), t);
            if (owedTok > 0) escrow.claimToken(t, owedTok);
            distribute(t);
        }

        address q = ICampaignAssetsView(address(campaign)).quoteToken();
        if (q != address(0)) {
            uint256 owedQ = escrow.balanceOfToken(address(this), q);
            if (owedQ > 0) escrow.claimToken(q, owedQ);
            distribute(q);
        }
    }
}
