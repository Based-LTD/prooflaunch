// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ProofBurner} from "../src/ProofBurner.sol";
import {ICampaignV2View, IPonsV2FactoryLegView} from "../src/V4LegBase.sol";
import {IPoolManagerMin} from "../src/interfaces/IUniV4.sol";

/// The platform flywheel's sink. PROOF_CAMPAIGN is the platform token's
/// own (already launched) campaign; the burner reads its token and curve
/// and can never be retargeted. Deploy AFTER the token, BEFORE v8.
contract DeployProofBurner is Script {
    function run() external {
        vm.startBroadcast();
        ProofBurner b = new ProofBurner(
            ICampaignV2View(vm.envAddress("PROOF_CAMPAIGN")),
            IPonsV2FactoryLegView(0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e),
            IPoolManagerMin(0x8366a39CC670B4001A1121B8F6A443A643e40951),
            0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044
        );
        vm.stopBroadcast();
        console2.log("ProofBurner :", address(b));
        console2.log("proofToken  :", b.proofToken());
    }
}
