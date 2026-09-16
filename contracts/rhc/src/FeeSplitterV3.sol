// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FeeSplitter} from "./FeeSplitter.sol";
import {IPonsV2FeeEscrow} from "./interfaces/IPonsV2.sol";

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

    constructor(
        address campaign_,
        IPonsV2FeeEscrow escrow_,
        uint16 backerBps_,
        address[] memory legRecipients_,
        uint16[] memory legBps_
    ) FeeSplitter(campaign_, backerBps_, legRecipients_, legBps_) {
        escrow = escrow_;
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
