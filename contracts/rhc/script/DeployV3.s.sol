// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignFactoryV3} from "../src/CampaignFactoryV3.sol";
import {LegDeployerV2} from "../src/LegDeployerV2.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";

/// Deploys LegDeployerV2 + CampaignFactoryV3 (v5): pons V2 with adjustable
/// creator tax AND the trustless bot legs ported to Uniswap v4.
///
///   PLATFORM_RECIPIENT=0x… REWARDS_RECIPIENT=0x… \
///   forge script script/DeployV3.s.sol --rpc-url rhc \
///     --keystore ~/.rhc-deployer/… --password "" --broadcast
contract DeployV3 is Script {
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant PONS_V2_LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    address constant PONS_V2_FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant MEME_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    address constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;

    function run() external {
        address platform = vm.envAddress("PLATFORM_RECIPIENT");
        address rewards = vm.envAddress("REWARDS_RECIPIENT");

        vm.startBroadcast();
        LegDeployerV2 legs = new LegDeployerV2();
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
            legs
        );
        vm.stopBroadcast();

        console2.log("LegDeployerV2:", address(legs));
        console2.log("CampaignFactoryV3:", address(f));
    }
}
