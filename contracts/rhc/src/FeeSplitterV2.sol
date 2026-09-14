// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FeeSplitter} from "./FeeSplitter.sol";
import {IPonsV2FeeEscrow} from "./interfaces/IPonsV2.sol";

interface ICampaignTokenView {
    function token() external view returns (address);
}

/// The V1 FeeSplitter with one addition for pons V2's pull-model: creator
/// fees are credited to this contract inside the pons FeeEscrow (native ETH
/// + the launched token), and `harvest()` — permissionless — pulls them home
/// and runs the internal accounting. Everything else (immutable split,
/// pull-based backer/leg claims, no owner) is inherited unchanged.
contract FeeSplitterV2 is FeeSplitter {
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

    /// Pull everything the escrow owes us, then account for it. Anyone may
    /// crank; claimBacker/claimLeg still work without it (they distribute()
    /// whatever already arrived), so this only ever helps.
    function harvest() external {
        uint256 owedEth = escrow.balanceOf(address(this));
        if (owedEth > 0) escrow.claim(owedEth);
        distribute(address(0));

        address t = ICampaignTokenView(address(campaign)).token();
        if (t != address(0)) {
            uint256 owedTok = escrow.balanceOfToken(address(this), t);
            if (owedTok > 0) escrow.claimToken(t, owedTok);
            distribute(t);
        }
    }
}
