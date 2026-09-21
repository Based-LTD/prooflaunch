// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignFactoryV6} from "../src/CampaignFactoryV6.sol";
import {LegDeployerV3} from "../src/LegDeployerV3.sol";
import {SplitterDeployerV4} from "../src/SplitterDeployerV4.sol";
import {IERC20} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";

/// v8 factory: v7 + FeeSplitterV4 (the fee stream follows the tokens).
///
/// ORDER MATTERS. REWARDS_RECIPIENT should be the RewardsVault, and the
/// vault's stakeToken is immutable — so the platform token must exist
/// (launched through v7) and the vault must be deployed BEFORE this runs.
/// Deploying v8 with the EOA as rewards recipient again would only be
/// worth it if the hold rule is wanted before the token; it is a factory
/// redeploy either way, and existing campaigns keep their terms forever.
///
/// Constructor deploys the CampaignDeployerV4 satellite (campaign creation
/// code can't live in the factory under EIP-170) — the expensive one.
contract DeployV6 is Script {

    function run() external {
        vm.startBroadcast();
        // LegDeployerV3 is already on mainnet (0x518B6b80…); the v3 legs are
        // unchanged in v8, so the new factory points at the existing one.
        LegDeployerV3 legs = LegDeployerV3(vm.envAddress("LEG_DEPLOYER"));
        SplitterDeployerV4 splitters = new SplitterDeployerV4();
        CampaignFactoryV6 f = new CampaignFactoryV6(
            vm.envAddress("PLATFORM_RECIPIENT"),
            vm.envAddress("REWARDS_RECIPIENT"),
            700, 300,
            IPonsV2Factory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e),
            IPonsV2LaunchAndBuy(0xe33E9E479dF8802cb0866d5d05258bEc4cF62948),
            0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e,
            IPoolManagerMin(0x8366a39CC670B4001A1121B8F6A443A643e40951),
            0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044,
            IV4StateView(0xF3334192D15450CdD385c8B70e03f9A6bD9E673b),
            legs,
            0.001 ether,
            IERC20(address(0)),
            0,
            vm.envAddress("EQUITY_ROUTER"), // deployed first; see DeployEquityRouter.s.sol
            address(splitters)
        );
        vm.stopBroadcast();
        console2.log("LegDeployerV3     :", address(legs), "(existing)");
        console2.log("CampaignFactoryV6 :", address(f));
        console2.log("splitterDeployerV4:", address(splitters));
        console2.log("campaignDeployerV4:", address(f.campaignDeployer()));
        console2.log("holderRewards     :", f.holderRewardsRecipient());
        console2.log("creationFee       :", f.creationFee());
        console2.log("platformBps       :", f.platformBps());
        console2.log("holderRewardsBps  :", f.holderRewardsBps());
        console2.log("equityRouter      :", f.equityRouter());
    }
}
