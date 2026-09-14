// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignFactoryV3} from "../src/CampaignFactoryV3.sol";
import {LegDeployerV2} from "../src/LegDeployerV2.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";

/// Factory-only deploy — LegDeployerV2 is ALREADY live at 0x42a2495D…
/// (first DeployV3 run landed it; the factory tx ran out of deployer gas).
/// Never re-run the combined script: it redeploys the satellite and burns
/// a nonce + gas (that's how the stray copy at 0xa5aC43cd… happened).
contract DeployV3Factory is Script {
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant PONS_V2_LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    address constant PONS_V2_FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address constant LEG_DEPLOYER_V2 = 0x42a2495D9426fd5d88A01e724E62275DCe02dfF4;

    function run() external {
        address platform = vm.envAddress("PLATFORM_RECIPIENT");
        address rewards = vm.envAddress("REWARDS_RECIPIENT");

        vm.startBroadcast();
        CampaignFactoryV3 f = new CampaignFactoryV3(
            platform,
            rewards,
            700,
            300,
            IPonsV2Factory(PONS_V2_FACTORY),
            IPonsV2LaunchAndBuy(PONS_V2_LAUNCH_AND_BUY),
            PONS_V2_FEE_ESCROW,
            IPoolManagerMin(POOL_MANAGER),
            MEME_HOOK,
            IV4StateView(STATE_VIEW),
            LegDeployerV2(LEG_DEPLOYER_V2)
        );
        vm.stopBroadcast();
        console2.log("CampaignFactoryV3:", address(f));
    }
}
