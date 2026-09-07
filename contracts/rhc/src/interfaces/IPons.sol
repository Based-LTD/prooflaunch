// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Minimal interfaces for the pons launchpad on Robinhood Chain (chain 4663).
///
/// Signatures recovered 2026-09-07 by bytecode selector extraction + live
/// calldata decode (see docs/rhc-poollaunch-spec.md §8). pons rotates factory
/// deployments (3 generations in 2 months) — treat addresses as config, never
/// constants, and verify `launchEnabled()` + recent TokenLaunched emission
/// before pointing a campaign at a factory.

struct PonsSocials {
    string twitter;
    string telegram;
    string discord;
    string website;
    string farcaster;
}

struct PonsTokenMeta {
    string name;
    string symbol;
    string logo;
    string description;
    PonsSocials socials;
    /// Creator-fee recipient, set at birth. For PoolLaunch this is ALWAYS the
    /// campaign's FeeSplitter — and neither Campaign nor FeeSplitter exposes
    /// any path to change it afterward (locker's setFeeRedirect is
    /// deployer-gated, and the deployer is the Campaign, which never calls it).
    address feeWallet;
}

interface IPonsFactory {
    /// Deploys token + v3 pool in one tx. `msg.value` = launchFee() + initial
    /// buy; the initial buy executes on the launch block, snipe-exempt.
    /// Verified permissionless (whitelist exists but is not required).
    function launchToken(
        PonsTokenMeta calldata meta,
        uint256 launchConfigId,
        uint256 dexId,
        bytes32 salt
    ) external payable returns (address token);

    function predictTokenAddress(
        PonsTokenMeta calldata meta,
        uint256 launchConfigId,
        uint256 dexId,
        bytes32 salt,
        address deployer
    ) external view returns (address);

    function launchFee() external view returns (uint256);
    function launchEnabled() external view returns (bool);
    function locker() external view returns (address);
    function graduationStatus(address token)
        external view returns (uint256 current, uint256 threshold, bool graduated);
}

interface IPonsLocker {
    /// Deployer-authorized (verified empirically on a fee-bearing token:
    /// random caller reverts 0xea8e4eb5, deployer succeeds). Campaign wraps
    /// this in a public pokeCollect() so collection stays permissionless.
    function collectFees(address token) external;

    /// zero = fees go to the launch-time feeWallet; nonzero = redirect.
    function feeRedirects(address token) external view returns (address);
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}
