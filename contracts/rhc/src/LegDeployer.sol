// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BurnLeg, IUniV3FactoryMin} from "./BurnLeg.sol";
import {FeedLPLeg} from "./FeedLPLeg.sol";

/// Carries the bot legs' creation code so CampaignFactory stays under the
/// EIP-170 contract-size limit (RHC enforces 24,576 bytes — the monolithic
/// v3 factory deploy failed on-chain at 27,523). The caller (the factory)
/// becomes each leg's one-time initializer.
contract LegDeployer {
    function deployBurn(address weth, IUniV3FactoryMin v3f, uint24 fee) external returns (BurnLeg) {
        return new BurnLeg(msg.sender, weth, v3f, fee);
    }

    function deployLp(address weth, IUniV3FactoryMin v3f, uint24 fee) external returns (FeedLPLeg) {
        return new FeedLPLeg(msg.sender, weth, v3f, fee);
    }
}
