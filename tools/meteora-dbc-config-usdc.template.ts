/**
 * USDC-quoted variant of meteora-dbc-config.template.ts.
 *
 * Identical curve shape, fee schedule, and liquidity-distribution mechanics
 * — only the QUOTE side changes from wrapped SOL → USDC. Three substantive
 * differences vs the SOL template:
 *
 *   1. quoteMint = USDC mainnet pubkey
 *   2. tokenQuoteDecimal = SIX (USDC is 6 decimals, SOL is 9)
 *   3. initialMarketCap / migrationMarketCap denominated in USDC, not SOL
 *      (the values are in *quote units*, the SDK converts internally)
 *
 * Comments in the original SOL template explain every other field — read
 * that first for context. Anything not commented here is "same value,
 * same reason."
 *
 *  PUBLIC SOURCES (same as SOL template):
 *      - Meteora studio scaffold:
 *        https://github.com/MeteoraAg/meteora-invent/blob/main/studio/config/dbc_config.jsonc
 *      - SDK types: node_modules/@meteora-ag/dynamic-bonding-curve-sdk/dist/index.d.ts
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import {
    type CreateConfigParams,
    type BuildCurveWithMarketCapParams,
    buildCurveWithMarketCap,
    ActivationType,
    TokenType,
    TokenDecimal,
    TokenUpdateAuthorityOption,
    CollectFeeMode,
    BaseFeeMode,
    MigrationOption,
    MigrationFeeOption,
    MigratedCollectFeeMode,
    DammV2DynamicFeeMode,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

// Platform wallet — Proof Launch's canonical platform-fee receiver.
// Same wallet used in the SOL config (CZnvVTT...).
const PLATFORM_WALLET = new PublicKey('CZnvVTTutAF7QTh5reQqRHE5i8J9cm1CWwaiQXi3QaXm');

// QUOTE = USDC (mainnet circle-issued).
// Mint address from Circle's official deployment record + Solscan confirmation:
//   https://developers.circle.com/stablecoins/docs/usdc-on-main-networks
const QUOTE_MINT_USDC = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// ---------------------------------------------------------------------------
// Market cap targets — DENOMINATED IN USDC (the quote currency) per the SDK
// convention. The SDK's buildCurveWithMarketCap treats `initialMarketCap` /
// `migrationMarketCap` as raw quote units (with no decimal scaling — the
// helper handles that based on tokenQuoteDecimal).
//
// We mirror the dollar value of the SOL config so creator UX stays
// consistent across launchpad picks:
//   SOL config:  initialMarketCap = 6 SOL    (~$900   @ $150/SOL)
//                migrationMarketCap = 460 SOL (~$69k  @ $150/SOL)
//   USDC config: initialMarketCap = 900 USDC
//                migrationMarketCap = 69_000 USDC
//
// If SOL price moves materially, the SOL config "feels" different in
// USD terms while this one stays anchored. That's a feature for USDC
// creators — predictable USD-denominated graduation target.
// ---------------------------------------------------------------------------
const buildParams: BuildCurveWithMarketCapParams = {
    initialMarketCap: 900,
    migrationMarketCap: 69_000,

    token: {
        tokenType: TokenType.SPL,
        tokenBaseDecimal: TokenDecimal.SIX,
        // QUOTE decimal — USDC is 6 decimals (not 9 like SOL).
        // Required to match the quote mint or the SDK math is off by 1000x.
        tokenQuoteDecimal: TokenDecimal.SIX,
        tokenUpdateAuthority: TokenUpdateAuthorityOption.Immutable,
        totalTokenSupply: 1_000_000_000,
        leftover: 0,
    },

    fee: {
        baseFeeParams: {
            baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
            feeSchedulerParam: {
                startingFeeBps: 100,
                endingFeeBps: 100,
                numberOfPeriod: 0,
                totalDuration: 0,
            },
        },
        dynamicFeeEnabled: false,
        collectFeeMode: CollectFeeMode.QuoteToken,
        // Same 100% creator-side routing as the SOL config — the
        // per-meme sub-escrow collects 100% of trading fees in USDC,
        // and our cron does the 90/5/5 split downstream.
        creatorTradingFeePercentage: 100,
        poolCreationFee: 0,
        enableFirstSwapWithMinFee: false,
    },

    migration: {
        migrationOption: MigrationOption.MET_DAMM_V2,
        migrationFeeOption: MigrationFeeOption.Customizable,
        migratedPoolFee: {
            collectFeeMode: MigratedCollectFeeMode.QuoteToken,
            dynamicFee: DammV2DynamicFeeMode.Disabled,
            // Same 0.5% post-grad LP fee as the SOL config — backer-favoring,
            // sits below the 1% curve fee, consistent UX across quotes.
            poolFeeBps: 50,
        },
        migrationFee: {
            feePercentage: 0,
            creatorFeePercentage: 0,
        },
    },

    liquidityDistribution: {
        partnerLiquidityPercentage: 50,
        creatorLiquidityPercentage: 40,
        partnerPermanentLockedLiquidityPercentage: 5,
        creatorPermanentLockedLiquidityPercentage: 5,
    },

    lockedVesting: {
        totalLockedVestingAmount: 0,
        numberOfVestingPeriod: 0,
        cliffUnlockAmount: 0,
        totalVestingDuration: 0,
        cliffDurationFromMigrationTime: 0,
    },

    activationType: ActivationType.Timestamp,
};

const curveConfig = buildCurveWithMarketCap(buildParams);

export const PROOF_LAUNCH_DBC_CONFIG_USDC_PARAMS: CreateConfigParams = {
    config: PublicKey.default,
    payer: PLATFORM_WALLET,
    feeClaimer: PLATFORM_WALLET,
    leftoverReceiver: PLATFORM_WALLET,
    quoteMint: QUOTE_MINT_USDC,
    ...curveConfig,
};

export function buildFreshProofLaunchDbcUsdcParams(opts: {
    payer: PublicKey;
    feeClaimer?: PublicKey;
    leftoverReceiver?: PublicKey;
}): { params: CreateConfigParams; configKeypair: Keypair } {
    const configKeypair = Keypair.generate();
    const params: CreateConfigParams = {
        ...PROOF_LAUNCH_DBC_CONFIG_USDC_PARAMS,
        config: configKeypair.publicKey,
        payer: opts.payer,
        feeClaimer: opts.feeClaimer ?? PROOF_LAUNCH_DBC_CONFIG_USDC_PARAMS.feeClaimer,
        leftoverReceiver: opts.leftoverReceiver ?? PROOF_LAUNCH_DBC_CONFIG_USDC_PARAMS.leftoverReceiver,
    };
    return { params, configKeypair };
}
