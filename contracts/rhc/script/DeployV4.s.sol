// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignFactoryV4} from "../src/CampaignFactoryV4.sol";
import {LegDeployerV2} from "../src/LegDeployerV2.sol";
import {IERC20} from "../src/interfaces/IPons.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";
import {IPoolManagerMin, IV4StateView} from "../src/interfaces/IUniV4.sol";

/// v6: creation fee 0.001 ETH, waiver dormant (redeploy with the platform
/// token address + threshold once it exists). Reuses the live LegDeployerV2.
contract DeployV4 is Script {
    address constant LEG_DEPLOYER_V2 = 0x42a2495D9426fd5d88A01e724E62275DCe02dfF4;

    function run() external {
        vm.startBroadcast();
        CampaignFactoryV4 f = new CampaignFactoryV4(
            vm.envAddress("PLATFORM_RECIPIENT"),
            vm.envAddress("REWARDS_RECIPIENT"),
            700, 300,
            IPonsV2Factory(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e),
            IPonsV2LaunchAndBuy(0xe33E9E479dF8802cb0866d5d05258bEc4cF62948),
            0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e,
            IPoolManagerMin(0x8366a39CC670B4001A1121B8F6A443A643e40951),
            0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044,
            IV4StateView(0xF3334192D15450CdD385c8B70e03f9A6bD9E673b),
            LegDeployerV2(LEG_DEPLOYER_V2),
            0.001 ether,
            IERC20(address(0)),
            0
        );
        vm.stopBroadcast();
        console2.log("CampaignFactoryV4:", address(f));
        console2.log("creationFee:", f.creationFee());
    }
}
