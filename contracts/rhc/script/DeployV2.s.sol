// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignFactoryV2} from "../src/CampaignFactoryV2.sol";
import {IPonsV2Factory, IPonsV2LaunchAndBuy} from "../src/interfaces/IPonsV2.sol";

/// Deploys CampaignFactoryV2 (pons V2 target: adjustable creator tax,
/// native-ETH quote, curve → locked Uniswap v4).
///
///   PLATFORM_RECIPIENT=0x… REWARDS_RECIPIENT=0x… \
///   forge script script/DeployV2.s.sol --rpc-url rhc \
///     --account rhc-deployer --broadcast
contract DeployV2 is Script {
    // Live pons V2 deployment (frontend-extracted, on-chain verified 2026-09-14)
    address constant PONS_V2_FACTORY = 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e;
    address constant PONS_V2_LAUNCH_AND_BUY = 0xe33E9E479dF8802cb0866d5d05258bEc4cF62948;
    address constant PONS_V2_FEE_ESCROW = 0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e;

    function run() external {
        address platform = vm.envAddress("PLATFORM_RECIPIENT");
        address rewards = vm.envAddress("REWARDS_RECIPIENT");

        vm.startBroadcast();
        CampaignFactoryV2 f = new CampaignFactoryV2(
            platform,
            rewards,
            700, // 7% platform
            300, // 3% holder rewards
            IPonsV2Factory(PONS_V2_FACTORY),
            IPonsV2LaunchAndBuy(PONS_V2_LAUNCH_AND_BUY),
            PONS_V2_FEE_ESCROW
        );
        vm.stopBroadcast();

        console2.log("CampaignFactoryV2:", address(f));
        console2.log("maxCreatorTaxBps (live pons cap):", IPonsV2Factory(PONS_V2_FACTORY).maxCreatorTaxBps());
    }
}
