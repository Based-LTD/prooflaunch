// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CampaignFactory} from "../src/CampaignFactory.sol";
import {IUniV3FactoryMin} from "../src/BurnLeg.sol";
import {LegDeployer} from "../src/LegDeployer.sol";

/// Deploys the PoolLaunch CampaignFactory to Robinhood Chain (4663).
///
/// Plan of record split: backers 90% / platform 7% / holder-rewards 3%.
/// The factory is stateless policy — if legs or bps ever need to change
/// (e.g. pointing holder-rewards at the platform-token burn contract once
/// it exists), deploy a NEW factory and point the frontend at it; campaigns
/// already created keep their immutable terms.
///
/// Usage:
///   export PLATFORM_RECIPIENT=0x...   # 7% leg
///   export REWARDS_RECIPIENT=0x...    # 3% leg
///   forge script script/Deploy.s.sol \
///     --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --keystore ~/.rhc-deployer/<file> --password "" \
///     --broadcast
///
/// The deployer key holds NO ongoing authority — the contracts have no
/// owner. It is a true throwaway after this transaction confirms.
contract Deploy is Script {
    function run() external {
        address platformRecipient = vm.envAddress("PLATFORM_RECIPIENT");
        address rewardsRecipient = vm.envAddress("REWARDS_RECIPIENT");

        vm.startBroadcast();
        LegDeployer legs = new LegDeployer();
        CampaignFactory f = new CampaignFactory(
            platformRecipient,
            rewardsRecipient,
            700, // platform 7%
            300, // holder-rewards 3%
            0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73, // WETH on RHC
            IUniV3FactoryMin(0x1f7d7550B1b028f7571E69A784071F0205FD2EfA), // pons v3 factory
            10000, // 1% pool fee tier
            legs
        );
        vm.stopBroadcast();

        console2.log("LegDeployer deployed:", address(legs));
        console2.log("CampaignFactory deployed:", address(f));
        console2.log("  platform leg (7%):", platformRecipient);
        console2.log("  rewards leg (3%):", rewardsRecipient);
        console2.log("  backers: 90%");
    }
}
