// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignFactoryV5} from "../src/CampaignFactoryV5.sol";
import {LegDeployerV3} from "../src/LegDeployerV3.sol";
import {IERC20} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";

/// v7 factory. Constructor also deploys the CampaignDeployerV3 satellite
/// (22,128B runtime — the campaign creation code cannot live in the
/// factory under EIP-170), so this is the expensive one.
///
/// holder-rewards still points at the existing EOA, NOT RewardsVault:
/// the vault's stakeToken is immutable and the RHC platform token does
/// not exist yet. Repointing is a factory redeploy, which is already how
/// every upgrade here works — existing campaigns keep their terms forever.
///
/// Fee waiver stays dormant (address(0), 0) for the same reason.
///
/// Deploys LegDeployerV3 first: the v3 legs (one crank per block, tick
/// range derived from pool spacing) are not on mainnet yet. LegDeployerV2
/// stays live for the v5/v6 factories that point at it.
contract DeployV5 is Script {

    function run() external {
        vm.startBroadcast();
        LegDeployerV3 legs = new LegDeployerV3();
        CampaignFactoryV5 f = new CampaignFactoryV5(
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
            vm.envAddress("EQUITY_ROUTER") // deployed first; see DeployEquityRouter.s.sol
        );
        vm.stopBroadcast();
        console2.log("LegDeployerV3     :", address(legs));
        console2.log("CampaignFactoryV5 :", address(f));
        console2.log("campaignDeployerV3:", address(f.campaignDeployer()));
        console2.log("creationFee       :", f.creationFee());
        console2.log("platformBps       :", f.platformBps());
        console2.log("holderRewardsBps  :", f.holderRewardsBps());
        console2.log("equityRouter      :", f.equityRouter());
    }
}
