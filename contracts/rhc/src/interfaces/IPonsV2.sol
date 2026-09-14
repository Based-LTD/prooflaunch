// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PonsSocials} from "./IPons.sol";

/// pons V2 (the live generation: bonding curve → locked Uniswap v4 pool).
/// ABI recovered from the pons frontend bundle and verified against live
/// launches on 2026-09-14:
///   factory       0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
///   launchAndBuy  0xe33E9E479dF8802cb0866d5d05258bEc4cF62948
///   feeEscrow     0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e
/// Key differences from V1:
///   - creatorTaxBps (0..maxCreatorTaxBps, live cap 1000 = 10%) set at
///     launch, can never be raised
///   - native-ETH quote (pairToken = address(0)); creator fees accrue on
///     the curve / v4 hook and are swept into the FeeEscrow, credited to
///     creatorFeeRecipient, who PULLS via claim/claimToken
///   - initial buy goes through the separate LaunchAndBuy contract and is
///     delivered to `recipient` (not to the feeWallet like V1)
///   - a buy that crosses the graduation threshold is partially refunded
///     to the buyer (CurveBuyRefunded)

struct PonsV2LaunchParams {
    string name;
    string symbol;
    string logo;
    string description;
    PonsSocials socials;
    address creatorFeeRecipient;
    uint16 creatorTaxBps;
    bool buybackEnabled;
    bytes32 expectedEconomics; // previewLaunchEconomics(configId, pairToken)
    bytes32 salt;
}

interface IPonsV2Factory {
    function launchEnabled() external view returns (bool);
    function launchFee() external view returns (uint256);
    function maxCreatorTaxBps() external view returns (uint256);
    function previewLaunchEconomics(uint256 launchConfigId, address pairToken) external view returns (bytes32);
    function launchToken(PonsV2LaunchParams calldata params, uint256 launchConfigId, address pairToken)
        external payable returns (address token, address curve);
    function transferCreatorFeeRecipient(address token, address newRecipient) external;
}

interface IPonsV2LaunchAndBuy {
    /// value = launchFee + amountIn (native quote). Tokens delivered to
    /// `recipient`; returns the fill.
    function launchAndBuy(
        PonsV2LaunchParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        uint256 amountIn,
        uint256 minTokensOut,
        address recipient,
        address[] calldata snipeTaxExemptions
    ) external payable returns (address token, address curve, uint256 tokensOut);
}

interface IPonsV2FeeEscrow {
    function balanceOf(address account) external view returns (uint256);
    function balanceOfToken(address account, address token) external view returns (uint256);
    function claim(uint256 amount) external;
    function claimToken(address token, uint256 amount) external;
}

interface IPonsV2Curve {
    function graduated() external view returns (bool);
    function creatorTaxBps() external view returns (uint256);
    function creatorTaxBalance() external view returns (uint256);
    function quoteFeeBalance() external view returns (uint256);
    function sweepFees(uint256 minBuybackTokensOut) external;
    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut);
    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut);
}
