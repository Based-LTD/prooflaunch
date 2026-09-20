// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignV2} from "../src/CampaignV2.sol";
import {BurnLegV2} from "../src/BurnLegV2.sol";
import {IERC20} from "../src/interfaces/IPons.sol";

/// Permissionless cranks on the founder's PL TEST launch: harvest the
/// escrow into the splitter, then run the burn leg. Anyone could send
/// these — that's the whole point.
contract CrankSmoke is Script {
    function run() external {
        CampaignV2 c = CampaignV2(payable(0x29aeBAE5Aac418dDb2088DF22c3F1FF68c4e2bF6));
        BurnLegV2 burn = BurnLegV2(payable(0xB3Ef76F1325E54C4c1Fd68eDB4Fa3DDf3e9714cb));
        vm.startBroadcast();
        c.pokeHarvest();
        burn.crank();
        vm.stopBroadcast();
        console2.log("burn leg totalEthSpent   :", burn.totalEthSpent());
        console2.log("burn leg totalTokensBurned:", burn.totalTokensBurned());
        console2.log("dead balance:", IERC20(c.token()).balanceOf(0x000000000000000000000000000000000000dEaD));
    }
}
