// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CampaignV2} from "./CampaignV2.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "./interfaces/IPonsV2.sol";
import {PonsTokenMeta} from "./interfaces/IPons.sol";

/// Deploys CampaignV2 + FeeSplitterV2 pairs against pons V2 — the live pons
/// generation with the adjustable creator tax. Platform policy (90/7/3
/// floor) lives here and only here; deployed campaigns are untouchable.
///
/// The pons target contracts are BAKED IN at deploy: a campaign created
/// through this factory can only ever launch through the real pons — no
/// creator-supplied launch target can sit in the money path.
///
/// v4 legs: holder-rewards, creator vault legs (named wallets, incl. the
/// platform airdrop operator), platform last (dust absorber). The trustless
/// Burn/FeedLP bot contracts remain a v3-factory feature until their
/// Uniswap-v4 ports ship — pons V2's native buybackEnabled covers the
/// buy-and-burn flywheel in the meantime.
contract CampaignFactoryV2 {
    address public immutable platformFeeRecipient;
    address public immutable holderRewardsRecipient;
    uint16 public immutable platformBps;      // 700 = 7%
    uint16 public immutable holderRewardsBps; // 300 = 3%

    IPonsV2Factory public immutable ponsFactory;
    IPonsV2LaunchAndBuy public immutable ponsLaunchAndBuy;
    address public immutable ponsFeeEscrow;

    event CampaignCreated(
        address indexed campaign,
        address indexed creator,
        address feeSplitter,
        uint256 goal,
        uint256 deadline,
        string symbol
    );
    event CampaignTerms(address indexed campaign, uint16 creatorTaxBps, bool buybackEnabled, uint16 vaultBpsTotal);

    error LegOverflow();
    error LengthMismatch();
    error TaxTooHigh();

    CampaignV2[] public campaigns;

    constructor(
        address platformFeeRecipient_,
        address holderRewardsRecipient_,
        uint16 platformBps_,
        uint16 holderRewardsBps_,
        IPonsV2Factory ponsFactory_,
        IPonsV2LaunchAndBuy ponsLaunchAndBuy_,
        address ponsFeeEscrow_
    ) {
        platformFeeRecipient = platformFeeRecipient_;
        holderRewardsRecipient = holderRewardsRecipient_;
        platformBps = platformBps_;
        holderRewardsBps = holderRewardsBps_;
        ponsFactory = ponsFactory_;
        ponsLaunchAndBuy = ponsLaunchAndBuy_;
        ponsFeeEscrow = ponsFeeEscrow_;
    }

    function createCampaign(
        uint256 goal,
        uint256 minDeposit,
        uint256 maxDeposit,
        uint256 maxBackers,
        uint256 deadline,
        uint256 launchConfigId,
        uint16 creatorTaxBps,
        bool buybackEnabled,
        PonsTokenMeta calldata meta,
        address[] calldata vaultRecipients,
        uint16[] calldata vaultBps
    ) external returns (CampaignV2 campaign) {
        if (vaultRecipients.length != vaultBps.length) revert LengthMismatch();
        // Live-read the pons cap so a pons-side change can never brick or
        // surprise a launch later — the check runs against today's rule.
        if (creatorTaxBps > ponsFactory.maxCreatorTaxBps()) revert TaxTooHigh();

        uint256 reserved = uint256(platformBps) + holderRewardsBps;
        for (uint256 i = 0; i < vaultBps.length; i++) reserved += vaultBps[i];
        if (reserved > 10_000) revert LegOverflow();
        uint16 backerBps = uint16(10_000 - reserved);

        uint256 legCount = 2 + vaultRecipients.length;
        address[] memory legs = new address[](legCount);
        uint16[] memory legBpsArr = new uint16[](legCount);
        uint256 n = 0;
        legs[n] = holderRewardsRecipient; legBpsArr[n++] = holderRewardsBps;
        for (uint256 i = 0; i < vaultRecipients.length; i++) {
            legs[n] = vaultRecipients[i]; legBpsArr[n++] = vaultBps[i];
        }
        // platform leg LAST — the splitter's dust-absorber slot
        legs[n] = platformFeeRecipient; legBpsArr[n++] = platformBps;

        campaign = new CampaignV2(
            msg.sender,
            ponsFactory,
            ponsLaunchAndBuy,
            ponsFeeEscrow,
            goal,
            minDeposit,
            maxDeposit,
            maxBackers,
            deadline,
            launchConfigId,
            creatorTaxBps,
            buybackEnabled,
            meta,
            backerBps,
            legs,
            legBpsArr
        );

        campaigns.push(campaign);
        emit CampaignCreated(
            address(campaign), msg.sender, address(campaign.feeSplitter()),
            goal, deadline, meta.symbol
        );
        {
            uint16 vaultTotal = 0;
            for (uint256 i = 0; i < vaultBps.length; i++) vaultTotal += vaultBps[i];
            emit CampaignTerms(address(campaign), creatorTaxBps, buybackEnabled, vaultTotal);
        }
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }
}
