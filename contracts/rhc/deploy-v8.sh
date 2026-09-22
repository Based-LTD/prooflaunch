#!/usr/bin/env bash
# Launch day, contracts half. Run AFTER $PROOF has launched on v7, from
# contracts/rhc, with .env filled (env.example) and PROOF_CAMPAIGN set to the
# launched campaign. Deploys the burner, feeds its address into the factory
# deploy, and writes v8.addresses.json for tools/flip-v8.mjs.
#
#   bash deploy-v8.sh ~/.rhc-deployer/<keystore file>
set -euo pipefail
KEYSTORE="${1:?keystore path}"
set -a; source .env; set +a
: "${PROOF_CAMPAIGN:?set PROOF_CAMPAIGN in .env to the launched \$PROOF campaign}"
: "${PLATFORM_BPS:?}"; : "${PROOF_BURN_BPS:?}"; : "${EQUITY_ROUTER:?}"; : "${LEG_DEPLOYER:?}"; : "${PLATFORM_RECIPIENT:?}"

echo "── 1/2 ProofBurner (target: $PROOF_CAMPAIGN)"
OUT1=$(forge script script/DeployProofBurner.s.sol --rpc-url rhc --broadcast --keystore "$KEYSTORE" -vv 2>&1 | tee /dev/stderr)
BURNER=$(echo "$OUT1" | grep -E "ProofBurner\s*:" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
TOKEN=$(echo "$OUT1" | grep -E "proofToken\s*:" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
: "${BURNER:?burner address not found in output}"
export PROOF_BURNER="$BURNER"
echo "PROOF_BURNER=$BURNER" >> .env

echo "── 2/2 CampaignFactoryV6 (v8) — burn ${PROOF_BURN_BPS} / platform ${PLATFORM_BPS} bps"
OUT2=$(forge script script/DeployV6.s.sol --rpc-url rhc --broadcast --keystore "$KEYSTORE" -vv 2>&1 | tee /dev/stderr)
FACTORY=$(echo "$OUT2" | grep -E "CampaignFactoryV6\s*:" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
CDEP=$(echo "$OUT2" | grep -E "campaignDeployerV4\s*:" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
SDEP=$(echo "$OUT2" | grep -E "splitterDeployerV4\s*:" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
: "${FACTORY:?factory address not found in output}"

cat > v8.addresses.json <<JSON
{
  "proofCampaign": "$PROOF_CAMPAIGN",
  "proofToken": "$TOKEN",
  "proofBurner": "$BURNER",
  "factoryV8": "$FACTORY",
  "campaignDeployerV4": "$CDEP",
  "splitterDeployerV4": "$SDEP",
  "platformBps": $PLATFORM_BPS,
  "proofBurnBps": $PROOF_BURN_BPS,
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON
echo; echo "Wrote v8.addresses.json:"; cat v8.addresses.json
echo; echo "Next: from the repo root →  node tools/flip-v8.mjs"
