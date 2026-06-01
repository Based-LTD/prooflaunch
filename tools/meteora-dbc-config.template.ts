/**
 * SUMMARY (read this before running on mainnet):
 *  - HIGH CONFIDENCE: tokenType, tokenBaseDecimal/QuoteDecimal, totalTokenSupply, migrationOption (DAMM v2),
 *    activationType (Timestamp), collectFeeMode (QuoteToken), creatorTradingFeePercentage (100 = max),
 *    dynamicFeeEnabled, lockedVesting (all zero), initialMarketCap/migrationMarketCap (Pump-style).
 *  - SAFE DEFAULTS (mirror Meteora studio scaffold; tune later if you want different shape):
 *    fee schedule (flat 100bps), liquidityDistribution (50/40 + 5+5 permanent-locked), buildCurveMode = WithMarketCap.
 *  - VERIFY BEFORE MAINNET: migrationFeeOption (LP fee tier post-graduation: 1% chosen to match curve);
 *    migrationFee.feePercentage (currently 0 — Meteora-charged % skim off quote threshold; set >0 only if you
 *    want a one-time platform skim at graduation); feeClaimer pubkey (placeholder must be replaced).
 *  - The `config` Pubkey is a fresh Keypair generated at runtime; this template just holds curve params.
 *  - PUBLIC SOURCES:
 *      - Meteora studio scaffold:
 *        https://github.com/MeteoraAg/meteora-invent/blob/main/studio/config/dbc_config.jsonc
 *        https://github.com/MeteoraAg/meteora-invent/blob/main/studio/src/lib/dbc/index.ts (createDbcConfig)
 *      - DBC docs: https://docs.meteora.ag/overview/products/dbc
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
} from '@meteora-ag/dynamic-bonding-curve-sdk';

// ---------------------------------------------------------------------------
// PARTNER (= Proof Launch platform wallet). Confirmed: CZnvVTTutAF7QTh5reQqRHE5i8J9cm1CWwaiQXi3QaXm
// At runtime the caller should substitute the real platform pubkey loaded from env/secret.
// `feeClaimer` receives the partner-side trading fees (10% of trading fee after creator-percentage split).
// `leftoverReceiver` receives any unsold leftover base tokens after migration; same wallet is fine.
// ---------------------------------------------------------------------------
const PLATFORM_WALLET = new PublicKey('CZnvVTTutAF7QTh5reQqRHE5i8J9cm1CWwaiQXi3QaXm');
// why: spec says feeClaimer = platform wallet at runtime. Keep as concrete pubkey so the file compiles
// and the runtime script can overwrite with the env-loaded key if desired.

// Quote mint = native SOL (wrapped).
// why: spec requires SOL-quoted curve; the Meteora studio scaffold uses the same constant.
// (dbc_config.jsonc: "quoteMint": "So11111111111111111111111111111111111111112")
const QUOTE_MINT_SOL = new PublicKey('So11111111111111111111111111111111111111112');

// ---------------------------------------------------------------------------
// Curve shape: built via buildCurveWithMarketCap (mirrors meteora-invent studio buildCurveMode = 1).
// initialMarketCap / migrationMarketCap are in QUOTE units (SOL), NOT lamports — the SDK helper
// converts internally. Confirmed by studio jsonc comment:
//   "the market cap of the DBC token pool ... specified in terms of quoteMint (not in lamports)"
//   https://github.com/MeteoraAg/meteora-invent/blob/main/studio/config/dbc_config.jsonc
// ---------------------------------------------------------------------------
const buildParams: BuildCurveWithMarketCapParams = {
    // Pump.fun virtual reserves give a starting market cap around ~$4-5k (≈ 30 SOL @ $150).
    // Spec says "~5-6 SOL initial market cap". We use 6 SOL to match the spec wording precisely.
    // why this value: matches spec; small enough that first buy moves price meaningfully (early-buyer reward).
    initialMarketCap: 6,
    // Pump graduation = $69k FDV. At $150/SOL ≈ 460 SOL. Spec says "~450 SOL".
    // why this value: matches the spec target; corresponds to migrationQuoteThreshold ≈ 85 SOL of *deposited quote*
    // (the threshold differs from the market-cap due to bonding-curve mechanics; SDK computes both).
    migrationMarketCap: 460,

    token: {
        tokenType: TokenType.SPL,
        // why: SPL is broadest compat. Token2022 (1) breaks routers/wallets. Studio default is 0.
        tokenBaseDecimal: TokenDecimal.SIX,
        // why: Pump.fun convention = 6 decimals; matches studio scaffold ("tokenBaseDecimal": 6).
        tokenQuoteDecimal: TokenDecimal.NINE,
        // why: SOL is 9 decimals. Required when quoteMint = wSOL.
        tokenUpdateAuthority: TokenUpdateAuthorityOption.Immutable,
        // why: Immutable mint = no rugpull vector via metadata edits. Studio default. Matches our fair-launch ethos.
        // Pump uses Immutable too.
        totalTokenSupply: 1_000_000_000,
        // why: 1B supply is Pump.fun's exact convention. Studio scaffold also uses 1_000_000_000.
        leftover: 0,
        // why: any unsold tokens on curve get sent to leftoverReceiver — 0 means curve must fully fill.
        // Setting >0 lets the partner reclaim dust. Studio default = 0; safest.
    },

    fee: {
        baseFeeParams: {
            baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
            // why: simplest mode; flat fee across whole curve (start == end). Studio default.
            feeSchedulerParam: {
                startingFeeBps: 100,
                // why: 1% trading fee per spec. 100 bps = 1.00%.
                endingFeeBps: 100,
                // why: flat curve (no decay). Match start to end => constant fee.
                numberOfPeriod: 0,
                // why: 0 periods + 0 duration = no schedule, fee is constant cliff at 100 bps.
                totalDuration: 0,
                // why: same — no time-based decay. activationType=Timestamp so units would be seconds if non-zero.
            },
        },
        dynamicFeeEnabled: false,
        // why: studio default in the scaffold is true (adds +20% of min base fee on volatility). We disable
        // because our backers expect predictable economics & the 90/10 redistribution math depends on a known fee.
        // SAFE-TO-FLIP: setting true is also valid; it just adds a small variable surcharge during volatility spikes.
        collectFeeMode: CollectFeeMode.QuoteToken,
        // why: spec says "creator trading fees ... drains into 90/10 split". Quote-only collection means all
        // fees accumulate as SOL (the quote), not as the meme token — exactly what our cron expects.
        // CollectFeeMode.OutputToken would give us fees in the meme token, breaking the cron + creating
        // sell pressure when we liquidate. QuoteToken is correct.
        creatorTradingFeePercentage: 100,
        // why: spec says "MAX creator fee share (since we redistribute from there)".
        // MAX_CREATOR_MIGRATION_FEE_PERCENTAGE = 100 (SDK index.d.ts:6684). 100 = 100% of trading fees
        // route to the *creator* sub-escrow (our per-meme keypair); 0 goes to partner. Our cron then
        // drains the creator sub-escrow into 90% backers / 10% platform.
        poolCreationFee: 0,
        // why: optional fee charged to creator when they spin up the pool. We charge $0 — fair launch.
        // MIN_POOL_CREATION_FEE = 1_000_000 lamports if non-zero (SDK:6689). 0 means feature disabled.
        enableFirstSwapWithMinFee: false,
        // why: gives first swapper the *minimum* fee instead of starting fee. Only useful when running
        // a bundled creator-buy at launch. We don't, so false (studio default).
    },

    migration: {
        migrationOption: MigrationOption.MET_DAMM_V2,
        // why: spec requires DAMM v2 (programmable fees + locked LP positions). Enum value = 1.
        migrationFeeOption: MigrationFeeOption.FixedBps100,
        // why: post-migration LP fee tier = 1% (matches our curve's 1% fee for a smooth transition).
        // Enum values: FixedBps25=0, FixedBps30=1, FixedBps100=2, FixedBps200=3, ... (SDK:5578)
        // VERIFY: Pump uses 0.3% (FixedBps30) on PumpSwap. We chose 1% to keep fee continuity; if you'd
        // rather match Pump's lower post-grad fee, switch to MigrationFeeOption.FixedBps30.
        // HIGH RISK FIELD: this is permanent — once a pool migrates, the LP fee tier is fixed forever.
        migrationFee: {
            feePercentage: 0,
            // why: % skim of the quote threshold paid to Meteora protocol + partner at migration time.
            // 0 = no skim (all quote goes to LP). Max = 50% (SDK constant MAX_MIGRATION_FEE_PERCENTAGE=99,
            // but docs cap at 50). HIGH RISK FIELD: this is REAL SOL that gets siphoned from your migrated
            // pool — every 1 here = ~4.5 SOL out of a 450-SOL graduation. Keep at 0 for true fair-launch
            // unless you want a launchpad-level take rate.
            creatorFeePercentage: 0,
            // why: of the migrationFee.feePercentage above, what % goes to creator vs partner.
            // Since feePercentage=0, this is moot. Range 0–100 (MAX_CREATOR_MIGRATION_FEE_PERCENTAGE=100).
        },
        // migratedPoolFee: omitted — only needed with migrationFeeOption=Customizable (6) or marketCap fee scheduler.
        // The SDK fills DEFAULT_MIGRATED_POOL_FEE_PARAMS = { collectFeeMode:0, dynamicFee:0, poolFeeBps:0 }
        // when omitted (SDK:6702).
    },

    liquidityDistribution: {
        // Must total 100. At least 10% must be permanent-locked OR vesting >=1day on DAMM v2.
        // Mirrors studio scaffold default split.
        partnerLiquidityPercentage: 50,
        // why: 50% of post-migration LP is partner-withdrawable. We (platform) own this LP and can use
        // it for treasury / sweeps. Studio default.
        creatorLiquidityPercentage: 40,
        // why: 40% goes to the meme's "creator" sub-escrow as withdrawable LP. Our cron will sweep this.
        partnerPermanentLockedLiquidityPercentage: 5,
        // why: 5% partner LP permanently locked. Counts toward the mandatory 10% locked minimum.
        creatorPermanentLockedLiquidityPercentage: 5,
        // why: 5% creator LP permanently locked. 5+5 = 10% locked, satisfies MIN_LOCKED_LIQUIDITY_BPS=1000 (SDK:6685).
        // VERIFY: if you want a more "fair" feel (more locked LP = less rug surface), bump these up
        // and reduce the withdrawable percentages. This is suboptimal-economics-not-loss territory.
    },

    lockedVesting: {
        totalLockedVestingAmount: 0,
        numberOfVestingPeriod: 0,
        cliffUnlockAmount: 0,
        totalVestingDuration: 0,
        cliffDurationFromMigrationTime: 0,
        // why: NO pre-migration vesting of the base token (Pump has no creator allocation; we don't either).
        // All five MUST be 0 together (studio default). Setting any non-zero requires the full set.
    },

    activationType: ActivationType.Timestamp,
    // why: Timestamp (1) means all durations are in seconds. Slot (0) means durations are in slots
    // (slot ≈ 0.4s). Timestamp is far more intuitive and is studio default. Our schedule is all-zero
    // anyway so this only matters if you ever enable a non-flat fee schedule.
};

// Build the curve. This computes sqrtStartPrice, the curve points, migrationQuoteThreshold,
// the tokenSupply struct (preMigration/postMigration), padding, etc. — fields we don't want to hand-set.
const curveConfig = buildCurveWithMarketCap(buildParams);

/**
 * Final params to pass to client.partner.createConfig(params).
 *
 * Runtime caller MUST:
 *  1. Generate a fresh Keypair for `config` (the config account is signer-required).
 *     Example:   const configKp = Keypair.generate();
 *                params.config = configKp.publicKey;
 *                // include configKp in the tx signers
 *  2. Set `payer` to whichever wallet pays rent + signs (typically the platform wallet).
 *  3. (Optionally) override `feeClaimer` / `leftoverReceiver` with env-loaded pubkeys.
 *
 * `config` and `payer` below are PLACEHOLDER pubkeys so the object is type-complete.
 */
export const PROOF_LAUNCH_DBC_CONFIG_PARAMS: CreateConfigParams = {
    // SIGNER fields — must be overridden at runtime.
    config: PublicKey.default,
    // why: placeholder. Real value = Keypair.generate().publicKey, generated by the create script
    // immediately before sending the tx. The matching Keypair must be passed as a signer.
    // HIGH RISK FIELD: if you accidentally reuse the same keypair across two pools, the second
    // createConfig call will fail (account already exists). Always fresh-generate.
    payer: PLATFORM_WALLET,
    // why: placeholder = platform wallet. Real value = the wallet actually paying tx fees / rent.
    // Must also be a signer.

    // PARTNER / LEFTOVER fields — placeholders per spec.
    feeClaimer: PLATFORM_WALLET,
    // why: spec — "leave as a placeholder pubkey ... will be the platform wallet at runtime".
    // feeClaimer collects the PARTNER share of trading fees (0% in our setup because
    // creatorTradingFeePercentage=100). Still required to be set.
    leftoverReceiver: PLATFORM_WALLET,
    // why: receives any unsold base tokens after migration. Platform wallet is the right home.
    quoteMint: QUOTE_MINT_SOL,
    // why: SOL per spec.

    // CURVE params — produced by buildCurveWithMarketCap. Spread to fill the rest of ConfigParameters.
    ...curveConfig,
};

/**
 * Helper export so the create script can re-derive a fresh config keypair + assemble the final params.
 */
export function buildFreshProofLaunchDbcParams(opts: {
    payer: PublicKey;
    feeClaimer?: PublicKey;
    leftoverReceiver?: PublicKey;
}): { params: CreateConfigParams; configKeypair: Keypair } {
    const configKeypair = Keypair.generate();
    const params: CreateConfigParams = {
        ...PROOF_LAUNCH_DBC_CONFIG_PARAMS,
        config: configKeypair.publicKey,
        payer: opts.payer,
        feeClaimer: opts.feeClaimer ?? PROOF_LAUNCH_DBC_CONFIG_PARAMS.feeClaimer,
        leftoverReceiver: opts.leftoverReceiver ?? PROOF_LAUNCH_DBC_CONFIG_PARAMS.leftoverReceiver,
    };
    return { params, configKeypair };
}
