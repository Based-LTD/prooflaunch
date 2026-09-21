#!/usr/bin/env bash
# Verify the live ProofLaunch contracts on Robinhood Chain's Blockscout so
# the source people read on the explorer is provably the deployed bytecode.
#
# 2026-09-21: Blockscout's /api is behind a Cloudflare browser challenge and
# rejects forge, so this submits to SOURCIFY (not walled; Blockscout imports
# Sourcify matches). All 8 below: exact_match on 2026-09-21. The browser path
# in verify/README.md remains as a fallback.
#
# Run from contracts/rhc (foundry.toml settings — via_ir, optimizer runs 200 —
# must match the deploy build):   bash verify.sh
#
# Constructor args are recovered from each creation tx (--guess-constructor-args).
# Contracts created BY contracts (the CREATE2 campaign satellite's campaigns,
# their splitters, bot legs) get "similar bytecode" verification from Blockscout
# automatically once the parent type is verified; if a specific instance still
# shows unverified, verify it with explicit --constructor-args.
set -euo pipefail
V=(--verifier sourcify --chain-id 4663 --rpc-url https://rpc.mainnet.chain.robinhood.com --guess-constructor-args --watch)

verify() { echo; echo "── $2 @ $1"; forge verify-contract "${V[@]}" "$1" "$2" || echo "!! failed: $2"; }

# ── v7 (ACTIVE) ──────────────────────────────────────────────────────
verify 0x0A568a0AdcC45F8f6597f0219df39FA9ACA82943 src/EquityRouter.sol:EquityRouter
verify 0x518B6b80736af35D25F98Cc403A7f2dD8a0763AB src/LegDeployerV3.sol:LegDeployerV3
verify 0x6928C1Ace232124641e9cfFEfD16D82E1B9c531B src/CampaignFactoryV5.sol:CampaignFactoryV5
verify 0xdDCf167F6DA48e8f6C1fC716fDFef4CCEEBd4fe3 src/CampaignFactoryV5.sol:CampaignDeployerV3
# first v7 campaign + its splitter (instances; parents above make these match)
verify 0x78BFd61594413C4B4A846839a145122F94Da5eEd src/CampaignV3.sol:CampaignV3
verify 0xFA3662B35FE3b698b97756d64f49D32fCD0f38Dc src/FeeSplitterV3.sol:FeeSplitterV3

# ── v6 (superseded, campaigns run forever) ───────────────────────────
verify 0xB86b783ccaCC20746ae9dd33CffE4a205B35E334 src/CampaignFactoryV4.sol:CampaignFactoryV4
verify 0x42a2495D9426fd5d88A01e724E62275DCe02dfF4 src/LegDeployerV2.sol:LegDeployerV2

echo; echo "Done. Check each address on https://robinhoodchain.blockscout.com — the Contract tab should show source, not bytecode."
