// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BurnLegV2} from "./BurnLegV2.sol";
import {FeedLPLegV2} from "./FeedLPLegV2.sol";
import {IPoolManagerMin, IV4StateView} from "./interfaces/IUniV4.sol";

/// Carries the v4 bot legs' creation code so the factory stays under
/// EIP-170 (RHC enforces 24,576 bytes — learned the hard way on v3).
/// The caller (the factory) becomes each leg's one-time initializer.
contract LegDeployerV2 {
    function deployBurn(IPoolManagerMin pm, address hook) external returns (BurnLegV2) {
        return new BurnLegV2(msg.sender, pm, hook);
    }

    function deployLp(IPoolManagerMin pm, address hook, IV4StateView sv) external returns (FeedLPLegV2) {
        return new FeedLPLegV2(msg.sender, pm, hook, sv);
    }
}
