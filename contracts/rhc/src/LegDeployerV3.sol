// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BurnLegV3} from "./BurnLegV3.sol";
import {FeedLPLegV3} from "./FeedLPLegV3.sol";
import {IPoolManagerMin, IV4StateView} from "./interfaces/IUniV4.sol";

/// Carries the v3 bot legs' creation code so the factory stays under
/// EIP-170. The caller (the factory) becomes each leg's one-time
/// initializer. V2 legs stay deployable from LegDeployerV2 for the
/// factories that already point at it; new factories point here.
contract LegDeployerV3 {
    function deployBurn(IPoolManagerMin pm, address hook) external returns (BurnLegV3) {
        return new BurnLegV3(msg.sender, pm, hook);
    }

    function deployLp(IPoolManagerMin pm, address hook, IV4StateView sv) external returns (FeedLPLegV3) {
        return new FeedLPLegV3(msg.sender, pm, hook, sv);
    }
}
