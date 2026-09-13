// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Campaign} from "./Campaign.sol";
import {BurnLeg, IUniV3FactoryMin, ICampaignView, IFeeSplitterLeg} from "./BurnLeg.sol";
import {IPonsFactory, PonsTokenMeta} from "./interfaces/IPons.sol";

/// Deploys Campaign + FeeSplitter pairs (and optional bot legs) and
/// enforces the platform's split floor. This is the ONLY place platform
/// policy lives; once a campaign is deployed, nothing here can touch it.
///
/// v2: creator bot legs, carved from the backer share — the RHC twin of
/// the SOL bot stack:
///   - burnBps: deploys an ownerless BurnLeg (buy-and-burn from fees)
///   - vault legs: any recipients the creator names (marketing / DAO /
///     LP wallets…) — the FeeSplitter's pull-based legs support them
///     natively
contract CampaignFactory {
    address public immutable platformFeeRecipient;
    address public immutable holderRewardsRecipient;
    uint16 public immutable platformBps;      // e.g. 700 = 7%
    uint16 public immutable holderRewardsBps; // e.g. 300 = 3%

    // BurnLeg wiring (pons trades on Uniswap-v3-style pools)
    address public immutable weth;
    IUniV3FactoryMin public immutable v3Factory;
    uint24 public immutable poolFee;

    event CampaignCreated(
        address indexed campaign,
        address indexed creator,
        address feeSplitter,
        uint256 goal,
        uint256 deadline,
        string symbol
    );
    event BotLegs(address indexed campaign, address burnLeg, uint16 burnBps, uint16 vaultBpsTotal);

    error LegOverflow();
    error LengthMismatch();

    Campaign[] public campaigns;

    constructor(
        address platformFeeRecipient_,
        address holderRewardsRecipient_,
        uint16 platformBps_,
        uint16 holderRewardsBps_,
        address weth_,
        IUniV3FactoryMin v3Factory_,
        uint24 poolFee_
    ) {
        platformFeeRecipient = platformFeeRecipient_;
        holderRewardsRecipient = holderRewardsRecipient_;
        platformBps = platformBps_;
        holderRewardsBps = holderRewardsBps_;
        weth = weth_;
        v3Factory = v3Factory_;
        poolFee = poolFee_;
    }

    /// Backers receive whatever the platform legs and the creator's bot
    /// legs don't take: 10000 − platform − rewards − burn − vaults.
    function createCampaign(
        IPonsFactory ponsFactory,
        uint256 goal,
        uint256 minDeposit,
        uint256 maxDeposit,
        uint256 maxBackers,
        uint256 deadline,
        uint256 launchConfigId,
        uint256 dexId,
        PonsTokenMeta calldata meta,
        uint16 burnBps,
        address[] calldata vaultRecipients,
        uint16[] calldata vaultBps
    ) external returns (Campaign campaign) {
        if (vaultRecipients.length != vaultBps.length) revert LengthMismatch();

        uint256 reserved = uint256(platformBps) + holderRewardsBps + burnBps;
        for (uint256 i = 0; i < vaultBps.length; i++) reserved += vaultBps[i];
        if (reserved > 10_000) revert LegOverflow();
        uint16 backerBps = uint16(10_000 - reserved);

        // Optional burn bot — deployed first (the splitter needs its
        // address as a leg), wired to the campaign right after.
        BurnLeg burnLeg = BurnLeg(address(0));
        if (burnBps > 0) {
            burnLeg = new BurnLeg(weth, v3Factory, poolFee);
        }

        uint256 legCount = 2 + vaultRecipients.length + (burnBps > 0 ? 1 : 0);
        address[] memory legs = new address[](legCount);
        uint16[] memory legBpsArr = new uint16[](legCount);
        uint256 n = 0;
        legs[n] = holderRewardsRecipient; legBpsArr[n++] = holderRewardsBps;
        if (burnBps > 0) { legs[n] = address(burnLeg); legBpsArr[n++] = burnBps; }
        for (uint256 i = 0; i < vaultRecipients.length; i++) {
            legs[n] = vaultRecipients[i]; legBpsArr[n++] = vaultBps[i];
        }
        // platform leg LAST — the splitter's dust-absorber slot
        legs[n] = platformFeeRecipient; legBpsArr[n++] = platformBps;

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
            legBpsArr
        );

        if (burnBps > 0) {
            burnLeg.init(ICampaignView(address(campaign)), IFeeSplitterLeg(address(campaign.feeSplitter())));
        }

        campaigns.push(campaign);
        emit CampaignCreated(
            address(campaign), msg.sender, address(campaign.feeSplitter()),
            goal, deadline, meta.symbol
        );
        {
            uint16 vaultTotal = 0;
            for (uint256 i = 0; i < vaultBps.length; i++) vaultTotal += vaultBps[i];
            emit BotLegs(address(campaign), address(burnLeg), burnBps, vaultTotal);
        }
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }
}
