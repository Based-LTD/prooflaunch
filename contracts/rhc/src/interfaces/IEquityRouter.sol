// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PoolKey} from "./IUniV4.sol";

/// ETH in, any ETH-paired v4 asset out. Deployed once; every claim
/// surface (RewardsVault, FeeSplitterV3) points at the same immutable
/// address so a claim can never be routed to a stranger's contract.
interface IEquityRouter {
    function routeEthTo(PoolKey calldata key, uint256 minOut, address recipient, bytes calldata hookData)
        external payable returns (uint256 assetOut);
}
