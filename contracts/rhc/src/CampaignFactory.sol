// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Campaign} from "./Campaign.sol";
import {IPonsFactory, PonsTokenMeta} from "./interfaces/IPons.sol";

/// Deploys Campaign + FeeSplitter pairs and enforces the platform's split
/// floor. This is the ONLY place platform policy lives; once a campaign is
/// deployed, nothing here can touch it.
contract CampaignFactory {
    /// Platform legs applied to every campaign (basis points of fee flow).
    address public immutable platformFeeRecipient;
    address public immutable holderRewardsRecipient;
    uint16 public immutable platformBps;      // e.g. 500 = 5%
    uint16 public immutable holderRewardsBps; // e.g. 500 = 5%

    event CampaignCreated(
        address indexed campaign,
        address indexed creator,
        address feeSplitter,
        uint256 goal,
        uint256 deadline,
        string symbol
    );

    Campaign[] public campaigns;

    constructor(
        address platformFeeRecipient_,
        address holderRewardsRecipient_,
        uint16 platformBps_,
        uint16 holderRewardsBps_
    ) {
        platformFeeRecipient = platformFeeRecipient_;
        holderRewardsRecipient = holderRewardsRecipient_;
        platformBps = platformBps_;
        holderRewardsBps = holderRewardsBps_;
    }

    /// backerBps is derived, not chosen: backers get everything the platform
    /// legs don't take. (Creator-side bot legs come later as extra legs
    /// carved from the backer share, mirroring the Solana bot stack.)
    function createCampaign(
        IPonsFactory ponsFactory,
        uint256 goal,
        uint256 minDeposit,
        uint256 maxDeposit,
        uint256 maxBackers,
        uint256 deadline,
        uint256 launchConfigId,
        uint256 dexId,
        PonsTokenMeta calldata meta
    ) external returns (Campaign campaign) {
        uint16 backerBps = 10_000 - platformBps - holderRewardsBps;
        address[] memory legs = new address[](2);
        uint16[] memory legBps = new uint16[](2);
        legs[0] = holderRewardsRecipient;
        legBps[0] = holderRewardsBps;
        legs[1] = platformFeeRecipient;
        legBps[1] = platformBps;

        campaign = new Campaign(
            msg.sender,
            ponsFactory,
            goal,
            minDeposit,
            maxDeposit,
            maxBackers,
            deadline,
            launchConfigId,
            dexId,
            meta,
            backerBps,
            legs,
            legBps
        );
        campaigns.push(campaign);
        emit CampaignCreated(
            address(campaign),
            msg.sender,
            address(campaign.feeSplitter()),
            goal,
            deadline,
            meta.symbol
        );
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }
}
