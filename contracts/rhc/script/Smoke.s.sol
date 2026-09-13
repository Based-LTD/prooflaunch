// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {Campaign} from "../src/Campaign.sol";
import {IPonsFactory, IERC20, PonsTokenMeta, PonsSocials} from "../src/interfaces/IPons.sol";

/// MAINNET SMOKE: run the full campaign lifecycle for real with dust-sized
/// amounts — create → deposit → launch (real pons token!) → claim.
/// Uses the throwaway deployer as creator AND sole backer.
///
///   export FACTORY=0x74Fa741f5E4F0089227cb1ce45B1d00c9698388d
///   forge script script/Smoke.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --keystore ~/.rhc-deployer/<file> --password "" --broadcast
contract Smoke is Script {
    function run() external {
        CampaignFactory cf = CampaignFactory(vm.envAddress("FACTORY"));
        address pons = 0xF4fC0CD27fC8EcF17E55eE4c3f7201897dF3eb75;

        vm.startBroadcast();

        Campaign c = cf.createCampaign(
            IPonsFactory(pons),
            0.002 ether,   // goal — dust
            0.0005 ether,  // min per backer
            0,             // max uncapped
            0,             // slots uncapped
            block.timestamp + 1 days,
            0, 0,
            PonsTokenMeta(
                "PoolLaunch Smoke", "PLSMOKE", "",
                "prooflaunch.fun mainnet smoke test - not for trading",
                PonsSocials("", "", "https://prooflaunch.fun", "", ""),
                address(0)
            ),
            0, new address[](0), new uint16[](0)
        );
        console2.log("campaign:", address(c));
        console2.log("splitter:", address(c.feeSplitter()));

        c.deposit{value: 0.002 ether}();
        console2.log("deposited, totalRaised:", c.totalRaised());

        c.launch();
        address token = c.token();
        console2.log("TOKEN LIVE ON PONS:", token);
        console2.log("tokensAtLaunch:", c.tokensAtLaunch());

        c.claimTokens();
        console2.log("claimed to backer:", IERC20(token).balanceOf(msg.sender));

        vm.stopBroadcast();
    }
}
