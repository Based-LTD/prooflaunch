// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CampaignV3, CampaignParams} from "./CampaignV3.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "./interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "./interfaces/IUniV4.sol";
import {IERC20} from "./interfaces/IPons.sol";
import {LegDeployerV2} from "./LegDeployerV2.sol";
import {BurnLegV2} from "./BurnLegV2.sol";
import {FeedLPLegV2} from "./FeedLPLegV2.sol";
import {ICampaignV2View, IFeeSplitterLegV2, IPonsV2FactoryLegView} from "./V4LegBase.sol";

/// Carries CampaignV3's creation code out of the factory (EIP-170) and
/// gives every campaign its CREATE2 address — the salt is ground
/// client-side until the address ends in the PoolLaunch signature
/// (0x…5EED). The caller (our factory) is baked into the derivation, so
/// only campaigns deployed through the real factory can wear it.
contract CampaignDeployerV3 {
    address public immutable factory;

    error OnlyFactory();

    constructor() {
        factory = msg.sender;
    }

    /// The exact CREATE2 init-code hash for a campaign with these args.
    /// The browser reads this once per configuration, then grinds salts
    /// locally against it — no contract bytecode in the bundle, no
    /// duplicated encoding logic to drift.
    function initCodeHash(
        address creator,
        IPonsV2Factory ponsFactory,
        IPonsV2LaunchAndBuy launchAndBuy,
        address ponsFeeEscrow,
        CampaignParams calldata p,
        uint16 backerBps,
        address[] calldata legs,
        uint16[] calldata legBps
    ) external pure returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                type(CampaignV3).creationCode,
                abi.encode(creator, ponsFactory, launchAndBuy, ponsFeeEscrow, p, backerBps, legs, legBps)
            )
        );
    }

    function deploy(
        bytes32 salt,
        address creator,
        IPonsV2Factory ponsFactory,
        IPonsV2LaunchAndBuy launchAndBuy,
        address ponsFeeEscrow,
        CampaignParams calldata p,
        uint16 backerBps,
        address[] calldata legs,
        uint16[] calldata legBps
    ) external payable returns (CampaignV3 c) {
        if (msg.sender != factory) revert OnlyFactory();
        c = new CampaignV3{salt: salt, value: msg.value}(
            creator, ponsFactory, launchAndBuy, ponsFeeEscrow, p, backerBps, legs, legBps
        );
    }
}

/// v7 factory — the full option surface behind one struct:
///   raises quoted in ETH, USDG, or tokenized stocks (any pons-approved
///   pair) · team rounds with contract-enforced reserved seats · token-
///   gated entry · CREATE2 signature addresses · creator tax · trustless
///   bot legs (native-quoted raises) · creation fee with on-chain holder
///   waiver. Policy lives here and only here; campaigns are untouchable.
contract CampaignFactoryV5 {
    address public immutable platformFeeRecipient;
    address public immutable holderRewardsRecipient;
    uint16 public immutable platformBps;
    uint16 public immutable holderRewardsBps;

    IPonsV2Factory public immutable ponsFactory;
    IPonsV2LaunchAndBuy public immutable ponsLaunchAndBuy;
    address public immutable ponsFeeEscrow;
    IPoolManagerMin public immutable poolManager;
    address public immutable memeHook;
    IV4StateView public immutable stateView;
    LegDeployerV2 public immutable legDeployer;
    CampaignDeployerV3 public immutable campaignDeployer;

    uint256 public immutable creationFee;
    IERC20 public immutable feeWaiverToken;
    uint256 public immutable feeWaiverThreshold;

    event CampaignCreated(
        address indexed campaign,
        address indexed creator,
        address feeSplitter,
        uint256 goal,
        uint256 deadline,
        string symbol
    );
    event CampaignTerms(
        address indexed campaign,
        uint16 creatorTaxBps,
        bool buybackEnabled,
        address quoteToken,
        address gateToken,
        uint16 reservedSeats,
        uint16 vaultBpsTotal
    );
    event BotLegs(address indexed campaign, address burnLeg, uint16 burnBps, address lpLeg, uint16 lpBps);

    error LegOverflow();
    error LengthMismatch();
    error TaxTooHigh();
    error BadFee();
    error BotsNeedNativeQuote();

    CampaignV3[] public campaigns;

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
        campaignDeployer = new CampaignDeployerV3();
        creationFee = creationFee_;
        feeWaiverToken = feeWaiverToken_;
        feeWaiverThreshold = feeWaiverThreshold_;
    }

    function creationFeeFor(address creator) public view returns (uint256) {
        if (
            address(feeWaiverToken) != address(0) &&
            feeWaiverThreshold > 0 &&
            feeWaiverToken.balanceOf(creator) >= feeWaiverThreshold
        ) return 0;
        return creationFee;
    }

    /// msg.value = creationFeeFor(you) + (ERC20-quoted raises only) the
    /// pons launch fee, escrowed into the campaign for launch day and
    /// refunded to you if the raise dies.
    function createCampaign(
        CampaignParams calldata p,
        uint16 burnBps,
        uint16 lpBps,
        address[] calldata vaultRecipients,
        uint16[] calldata vaultBps,
        bytes32 salt
    ) external payable returns (CampaignV3 campaign) {
        if (vaultRecipients.length != vaultBps.length) revert LengthMismatch();
        if (p.creatorTaxBps > ponsFactory.maxCreatorTaxBps()) revert TaxTooHigh();
        // v4-leg bots trade the native pool; ERC20-quoted raises defer them
        if (p.quoteToken != address(0) && (burnBps > 0 || lpBps > 0)) revert BotsNeedNativeQuote();

        // exact buy-in + (ERC20 quote) exact pons launch-fee escrow
        uint256 fee = creationFeeFor(msg.sender);
        uint256 launchFeeEscrow = p.quoteToken == address(0) ? 0 : ponsFactory.launchFee();
        if (msg.value != fee + launchFeeEscrow) revert BadFee();
        if (fee > 0) {
            (bool ok, ) = platformFeeRecipient.call{value: fee}("");
            if (!ok) revert BadFee();
        }

        BurnLegV2 burnLeg = BurnLegV2(payable(address(0)));
        if (burnBps > 0) burnLeg = legDeployer.deployBurn(poolManager, memeHook);
        FeedLPLegV2 lpLeg = FeedLPLegV2(payable(address(0)));
        if (lpBps > 0) lpLeg = legDeployer.deployLp(poolManager, memeHook, stateView);

        (uint16 backerBps, address[] memory legs, uint16[] memory legBpsArr) =
            previewLegs(burnBps, lpBps, vaultRecipients, vaultBps, address(burnLeg), address(lpLeg));

        campaign = campaignDeployer.deploy{value: launchFeeEscrow}(
            salt, msg.sender, ponsFactory, ponsLaunchAndBuy, ponsFeeEscrow,
            p, backerBps, legs, legBpsArr
        );

        if (burnBps > 0) {
            burnLeg.init(ICampaignV2View(address(campaign)), IFeeSplitterLegV2(address(campaign.feeSplitter())), IPonsV2FactoryLegView(address(ponsFactory)));
        }
        if (lpBps > 0) {
            lpLeg.init(ICampaignV2View(address(campaign)), IFeeSplitterLegV2(address(campaign.feeSplitter())), IPonsV2FactoryLegView(address(ponsFactory)));
        }

        campaigns.push(campaign);
        emit CampaignCreated(
            address(campaign), msg.sender, address(campaign.feeSplitter()),
            p.goal, p.deadline, p.meta.symbol
        );
        {
            uint16 vaultTotal = 0;
            for (uint256 i = 0; i < vaultBps.length; i++) vaultTotal += vaultBps[i];
            emit CampaignTerms(address(campaign), p.creatorTaxBps, p.buybackEnabled, p.quoteToken, p.gateToken, p.reservedSeats, vaultTotal);
        }
        emit BotLegs(address(campaign), address(burnLeg), burnBps, address(lpLeg), lpBps);
    }

    /// Leg table construction — the ONE implementation, shared by
    /// createCampaign and the vanity preview so they can never drift.
    /// Order is load-bearing: rewards, burn?, lp?, vaults…, platform LAST
    /// (the splitter's dust absorber).
    function previewLegs(
        uint16 burnBps,
        uint16 lpBps,
        address[] calldata vaultRecipients,
        uint16[] calldata vaultBps,
        address burnLeg,
        address lpLeg
    ) public view returns (uint16 backerBps, address[] memory legs, uint16[] memory legBps) {
        uint256 reserved = uint256(platformBps) + holderRewardsBps + burnBps + lpBps;
        for (uint256 i = 0; i < vaultBps.length; i++) reserved += vaultBps[i];
        if (reserved > 10_000) revert LegOverflow();
        backerBps = uint16(10_000 - reserved);

        uint256 legCount = 2 + vaultRecipients.length + (burnBps > 0 ? 1 : 0) + (lpBps > 0 ? 1 : 0);
        legs = new address[](legCount);
        legBps = new uint16[](legCount);
        uint256 n = 0;
        legs[n] = holderRewardsRecipient; legBps[n++] = holderRewardsBps;
        if (burnBps > 0) { legs[n] = burnLeg; legBps[n++] = burnBps; }
        if (lpBps > 0) { legs[n] = lpLeg; legBps[n++] = lpBps; }
        for (uint256 i = 0; i < vaultRecipients.length; i++) {
            legs[n] = vaultRecipients[i]; legBps[n++] = vaultBps[i];
        }
        legs[n] = platformFeeRecipient; legBps[n++] = platformBps;
    }

    /// One read for the browser's salt grinder: the CREATE2 init-code hash
    /// this exact configuration will deploy with. Campaigns WITHOUT bot
    /// legs are fully deterministic. With bot legs, pass the predicted
    /// leg addresses (LegDeployerV2's next CREATE nonces) — if another
    /// bot campaign lands first the prediction shifts and the address
    /// simply misses the signature. Cosmetic only; nothing is at risk.
    function previewInitCodeHash(
        address creator,
        CampaignParams calldata p,
        uint16 burnBps,
        uint16 lpBps,
        address[] calldata vaultRecipients,
        uint16[] calldata vaultBps,
        address predictedBurnLeg,
        address predictedLpLeg
    ) external view returns (bytes32) {
        (uint16 backerBps, address[] memory legs, uint16[] memory legBps) =
            previewLegs(burnBps, lpBps, vaultRecipients, vaultBps, predictedBurnLeg, predictedLpLeg);
        return campaignDeployer.initCodeHash(
            creator, ponsFactory, ponsLaunchAndBuy, ponsFeeEscrow, p, backerBps, legs, legBps
        );
    }

    function campaignCount() external view returns (uint256) {
        return campaigns.length;
    }
}
