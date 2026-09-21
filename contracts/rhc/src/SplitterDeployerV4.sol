// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FeeSplitterV4} from "./FeeSplitterV4.sol";
import {IPonsV2FeeEscrow} from "./interfaces/IPonsV2.sol";
import {IEquityRouter} from "./interfaces/IEquityRouter.sol";

interface ISplitterDeployerV4 {
    function deploy(
        IPonsV2FeeEscrow escrow,
        uint16 backerBps,
        address[] calldata legRecipients,
        uint16[] calldata legBps,
        IEquityRouter equityRouter,
        address forfeitTo
    ) external returns (FeeSplitterV4);
}

/// Carries FeeSplitterV4's creation code out of the campaign (EIP-170:
/// with the splitter inlined, CampaignDeployerV4 ran 26.7KB). The caller
/// — a campaign under construction — becomes the splitter's campaign, so
/// a splitter can only ever point at whoever deployed it. Same shape as
/// LegDeployerV3; no owner, no state.
contract SplitterDeployerV4 is ISplitterDeployerV4 {
    function deploy(
        IPonsV2FeeEscrow escrow,
        uint16 backerBps,
        address[] calldata legRecipients,
        uint16[] calldata legBps,
        IEquityRouter equityRouter,
        address forfeitTo
    ) external returns (FeeSplitterV4) {
        return new FeeSplitterV4(msg.sender, escrow, backerBps, legRecipients, legBps, equityRouter, forfeitTo);
    }
}
