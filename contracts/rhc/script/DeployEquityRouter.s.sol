// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {EquityRouter} from "../src/EquityRouter.sol";
import {IPoolManagerMin} from "../src/interfaces/IUniV4.sol";

/// EquityRouter — ETH in, tokenized equity out. No constructor policy
/// beyond the PoolManager: it holds no asset list, so nothing here needs
/// revisiting when Robinhood tokenizes something new.
contract DeployEquityRouter is Script {
    // Uniswap v4 singleton on RHC. Measure depth HERE, not in v3 — the v3
    // pools for these assets are near-empty (see RWA_POOLS.md).
    IPoolManagerMin constant POOL_MANAGER =
        IPoolManagerMin(0x8366a39CC670B4001A1121B8F6A443A643e40951);

    function run() external {
        vm.startBroadcast();
        EquityRouter r = new EquityRouter(POOL_MANAGER);
        vm.stopBroadcast();
        console2.log("EquityRouter:", address(r));
        console2.log("poolManager :", address(r.poolManager()));
    }
}
