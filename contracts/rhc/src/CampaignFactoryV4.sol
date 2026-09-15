// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CampaignV2} from "./CampaignV2.sol";
import {IERC20} from "./interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "./interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "./interfaces/IUniV4.sol";
import {PonsTokenMeta} from "./interfaces/IPons.sol";
import {LegDeployerV2} from "./LegDeployerV2.sol";
import {BurnLegV2} from "./BurnLegV2.sol";
import {FeedLPLegV2} from "./FeedLPLegV2.sol";
import {ICampaignV2View, IFeeSplitterLegV2, IPonsV2FactoryLegView} from "./V4LegBase.sol";

/// v6 — v5 (tax + trustless v4 bot legs) plus the creation buy-in:
/// an immutable creation fee paid with createCampaign, forwarded straight
/// to the platform recipient (never held here). Spam control, not revenue
/// — the goal-based model already starves junk raises, the fee just stops
/// free-roll board flooding. Waiver hooks are baked in but dormant:
/// deploy with feeWaiverToken = 0 now; once the platform token launches
/// on RHC, redeploy with (token, threshold) and holders create free —
/// the check is an on-chain balance read, enforced by the contract
/// rather than by our server (the SOL waiver, minus the trust).
contract CampaignFactoryV4 {
    address public immutable platformFeeRecipient;
    address public immutable holderRewardsRecipient;
    uint16 public immutable platformBps;      // 700 = 7%
    uint16 public immutable holderRewardsBps; // 300 = 3%

    IPonsV2Factory public immutable ponsFactory;
    IPonsV2LaunchAndBuy public immutable ponsLaunchAndBuy;
    address public immutable ponsFeeEscrow;
    IPoolManagerMin public immutable poolManager;
    address public immutable memeHook;
    IV4StateView public immutable stateView;
    LegDeployerV2 public immutable legDeployer; // keeps this contract under EIP-170

    uint256 public immutable creationFee;        // wei, paid with createCampaign
    IERC20 public immutable feeWaiverToken;      // address(0) = waiver disabled
    uint256 public immutable feeWaiverThreshold; // min balance for a free create

    event CampaignCreated(
        address indexed campaign,
        address indexed creator,
        address feeSplitter,
        uint256 goal,
        uint256 deadline,
        string symbol
    );
    event CampaignTerms(address indexed campaign, uint16 creatorTaxBps, bool buybackEnabled, uint16 vaultBpsTotal);
    event BotLegs(address indexed campaign, address burnLeg, uint16 burnBps, address lpLeg, uint16 lpBps);

    error LegOverflow();
    error LengthMismatch();
    error TaxTooHigh();
    error BadFee();

    CampaignV2[] public campaigns;

    constructor(
        address platformFeeRecipient_,
        address holderRewardsRecipient_,
        uint16 platformBps_,
        uint16 holderRewardsBps_,
        IPonsV2Factory ponsFactory_,
        IPonsV2LaunchAndBuy ponsLaunchAndBuy_,
        address ponsFeeEscrow_,
        IPoolManagerMin poolManager_,
        address memeHook_,
        IV4StateView stateView_,
        LegDeployerV2 legDeployer_,
        uint256 creationFee_,
        IERC20 feeWaiverToken_,
        uint256 feeWaiverThreshold_
    ) {
        platformFeeRecipient = platformFeeRecipient_;
        holderRewardsRecipient = holderRewardsRecipient_;
        platformBps = platformBps_;
        holderRewardsBps = holderRewardsBps_;
        ponsFactory = ponsFactory_;
        ponsLaunchAndBuy = ponsLaunchAndBuy_;
        ponsFeeEscrow = ponsFeeEscrow_;
        poolManager = poolManager_;
        memeHook = memeHook_;
        stateView = stateView_;
        legDeployer = legDeployer_;
        creationFee = creationFee_;
        feeWaiverToken = feeWaiverToken_;
        feeWaiverThreshold = feeWaiverThreshold_;
    }

    /// What this caller owes to create — 0 for waiver-qualified holders.
    function creationFeeFor(address creator) public view returns (uint256) {
        if (
            address(feeWaiverToken) != address(0) &&
            feeWaiverThreshold > 0 &&
            feeWaiverToken.balanceOf(creator) >= feeWaiverThreshold
        ) return 0;
        return creationFee;
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
        uint16 burnBps,
        uint16 lpBps,
        address[] calldata vaultRecipients,
        uint16[] calldata vaultBps
    ) external payable returns (CampaignV2 campaign) {
        // exact-fee buy-in, forwarded immediately — this contract never
        // holds a balance
        if (msg.value != creationFeeFor(msg.sender)) revert BadFee();
        if (msg.value > 0) {
            (bool ok, ) = platformFeeRecipient.call{value: msg.value}("");
            if (!ok) revert BadFee();
        }
        if (vaultRecipients.length != vaultBps.length) revert LengthMismatch();
        if (creatorTaxBps > ponsFactory.maxCreatorTaxBps()) revert TaxTooHigh();

        uint256 reserved = uint256(platformBps) + holderRewardsBps + burnBps + lpBps;
        for (uint256 i = 0; i < vaultBps.length; i++) reserved += vaultBps[i];
        if (reserved > 10_000) revert LegOverflow();
        uint16 backerBps = uint16(10_000 - reserved);

        BurnLegV2 burnLeg = BurnLegV2(payable(address(0)));
        if (burnBps > 0) burnLeg = legDeployer.deployBurn(poolManager, memeHook);
        FeedLPLegV2 lpLeg = FeedLPLegV2(payable(address(0)));
        if (lpBps > 0) lpLeg = legDeployer.deployLp(poolManager, memeHook, stateView);

        uint256 legCount = 2 + vaultRecipients.length + (burnBps > 0 ? 1 : 0) + (lpBps > 0 ? 1 : 0);
        address[] memory legs = new address[](legCount);
        uint16[] memory legBpsArr = new uint16[](legCount);
        uint256 n = 0;
        legs[n] = holderRewardsRecipient; legBpsArr[n++] = holderRewardsBps;
        if (burnBps > 0) { legs[n] = address(burnLeg); legBpsArr[n++] = burnBps; }
        if (lpBps > 0) { legs[n] = address(lpLeg); legBpsArr[n++] = lpBps; }
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

        if (burnBps > 0) {
            burnLeg.init(
                ICampaignV2View(address(campaign)),
                IFeeSplitterLegV2(address(campaign.feeSplitter())),
                IPonsV2FactoryLegView(address(ponsFactory))
            );
        }
        if (lpBps > 0) {
            lpLeg.init(
                ICampaignV2View(address(campaign)),
                IFeeSplitterLegV2(address(campaign.feeSplitter())),
                IPonsV2FactoryLegView(address(ponsFactory))
            );
        }

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
        emit BotLegs(address(campaign), address(burnLeg), burnBps, address(lpLeg), lpBps);
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }
}
