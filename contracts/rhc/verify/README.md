# Verifying the live contracts on Blockscout (browser path)

The explorer's API is behind a Cloudflare browser challenge, so
`forge verify-contract` (and `verify.sh`) cannot reach it. The browser can.
Every live contract was built from one compilation, so ONE standard JSON
input verifies all of them: `standard-input.json` (solc 0.8.26, via-IR,
optimizer 200 runs, EVM cancun — those settings are inside the file).

Regenerate after any change to `src/`:
`forge build --build-info --force` then copy `out/build-info/*.json` → `.input`
(see the python in the session that produced this, or just re-run verify.sh
once the API is reachable).

## Per contract, on https://robinhoodchain.blockscout.com/address/<ADDRESS>?tab=contract

1. Click **Verify & publish**.
2. Verification method: **Solidity (Standard JSON input)**.
3. Compiler: **v0.8.26+commit.8a97fa7a**. (License: MIT.)
4. Upload `standard-input.json`.
5. Leave **"Try to fetch constructor arguments automatically"** checked
   (it reads them from the creation tx). If it fails for a contract-created
   instance, see the note below.
6. Contract name: pick from the table. Verify.

| Contract (pick this name) | Address |
|---|---|
| `EquityRouter` | `0x0A568a0AdcC45F8f6597f0219df39FA9ACA82943` |
| `LegDeployerV3` | `0x518B6b80736af35D25F98Cc403A7f2dD8a0763AB` |
| `CampaignFactoryV5` (the v7 factory) | `0x6928C1Ace232124641e9cfFEfD16D82E1B9c531B` |
| `CampaignDeployerV3` (its satellite) | `0xdDCf167F6DA48e8f6C1fC716fDFef4CCEEBd4fe3` |
| `CampaignV3` (RWA TEST) | `0x78BFd61594413C4B4A846839a145122F94Da5eEd` |
| `FeeSplitterV3` (RWA TEST's splitter) | `0xFA3662B35FE3b698b97756d64f49D32fCD0f38Dc` |
| `CampaignFactoryV4` (the v6 factory) | `0xB86b783ccaCC20746ae9dd33CffE4a205B35E334` |
| `LegDeployerV2` | `0x42a2495D9426fd5d88A01e724E62275DCe02dfF4` |

Order matters a little: do the factory and the satellite first — once a
contract type is verified, Blockscout matches other instances with the
same bytecode (every campaign, every splitter) on its own.

## If constructor-argument auto-fetch fails

Campaigns and splitters are created by other contracts (CREATE2 satellite →
campaign → splitter), and the auto-fetch sometimes can't see internal
creations. The args are the tail of the creation code; ask for them and
they'll be computed from the creation tx trace.
