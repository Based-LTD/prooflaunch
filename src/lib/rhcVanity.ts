// 0x…5EED — the PoolLaunch signature address.
//
// On Solana the signature was "…pooL" and cost us a grinding rig plus a
// vault of pre-generated keypairs. On an EVM chain it costs a keccak
// loop: CREATE2 addresses are pure math over (deployer, salt, init-code
// hash), and the salt is a public number, not a secret. Nothing to
// custody, nothing to leak, no infrastructure.
//
//   address = keccak256(0xff ++ deployer ++ salt ++ initCodeHash)[12:]
//
// The init-code hash comes from the factory's previewInitCodeHash view,
// so the browser never carries contract bytecode and the encoding can
// never drift from what actually deploys (pinned by VanityTest).
//
// NOT to be confused with lib/vanity.ts — that one is the SOLANA
// pre-ground keypair pool ("…pooL" mints), a completely different
// mechanism that needs real custody. This file is pure math.

import { keccak256, getContractAddress, type Address, type Hex } from 'viem';

/** The signature every PoolLaunch campaign address ends with. */
export const SIGNATURE_SUFFIX = '5eed';

export interface GrindResult {
  salt: Hex;
  address: Address;
  attempts: number;
  found: boolean;
  ms: number;
}

const HEX = '0123456789abcdef';

function toBytes20(addr: Address): Uint8Array {
  const out = new Uint8Array(20);
  for (let i = 0; i < 20; i++) out[i] = parseInt(addr.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

function toBytes32(hex: Hex): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

function bytesToHex(b: Uint8Array): Hex {
  let s = '0x';
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s as Hex;
}

/** CREATE2 address for a given salt. Pure math, no RPC. */
export function predictCreate2(deployer: Address, salt: Hex, initCodeHash: Hex): Address {
  const buf = new Uint8Array(85);
  buf[0] = 0xff;
  buf.set(toBytes20(deployer), 1);
  buf.set(toBytes32(salt), 21);
  buf.set(toBytes32(initCodeHash), 53);
  const h = keccak256(buf);
  return ('0x' + h.slice(26)) as Address;
}

/**
 * Grind salts until the resulting address ends with `suffix`.
 *
 * Four hex characters means one match per 65,536 tries on average, which
 * is a few hundred milliseconds of keccak — fast enough to run inline
 * while the creator's finger is still on the button. The buffer is built
 * once and only the salt bytes are patched per attempt.
 *
 * Bounded by BOTH a try count and a wall-clock budget: a slow phone must
 * never hang the form. Returning found:false is fine — the campaign
 * deploys at a perfectly good non-signature address.
 */
export function grindVanitySalt(opts: {
  deployer: Address;
  initCodeHash: Hex;
  suffix?: string;
  maxAttempts?: number;
  timeBudgetMs?: number;
  startAt?: number;
}): GrindResult {
  const suffix = (opts.suffix ?? SIGNATURE_SUFFIX).toLowerCase();
  const maxAttempts = opts.maxAttempts ?? 3_000_000;
  const timeBudgetMs = opts.timeBudgetMs ?? 8_000;
  // Random start so two people configuring identical campaigns in the
  // same block don't grind into the same salt and collide on deploy.
  // Kept under 2^31 so the byte patching below stays in int32 territory.
  const start = opts.startAt ?? Math.floor(Math.random() * 1e9);

  const buf = new Uint8Array(85);
  buf[0] = 0xff;
  buf.set(toBytes20(opts.deployer), 1);
  buf.set(toBytes32(opts.initCodeHash), 53);

  const t0 = Date.now();
  let checkedClock = 0;

  for (let i = 0; i < maxAttempts; i++) {
    const n = start + i;
    // salt = bytes32(uint256(n)): right-aligned big-endian, so the salt
    // reads as a plain number on-chain. Salt byte k lives at buf[21+k],
    // so the low 5 bytes are buf[48..52].
    buf[48] = (n / 0x100000000) & 0xff;
    buf[49] = (n >>> 24) & 0xff;
    buf[50] = (n >>> 16) & 0xff;
    buf[51] = (n >>> 8) & 0xff;
    buf[52] = n & 0xff;

    const h = keccak256(buf);
    if (h.endsWith(suffix)) {
      const saltBytes = buf.slice(21, 53);
      return {
        salt: bytesToHex(saltBytes),
        address: ('0x' + h.slice(26)) as Address,
        attempts: i + 1,
        found: true,
        ms: Date.now() - t0,
      };
    }

    // check the clock every 4096 tries, not every try
    if ((i & 0xfff) === 0xfff) {
      checkedClock = Date.now() - t0;
      if (checkedClock > timeBudgetMs) {
        const saltBytes = buf.slice(21, 53);
        return {
          salt: bytesToHex(saltBytes),
          address: predictCreate2(opts.deployer, bytesToHex(saltBytes), opts.initCodeHash),
          attempts: i + 1,
          found: false,
          ms: checkedClock,
        };
      }
    }
  }

  const saltBytes = buf.slice(21, 53);
  return {
    salt: bytesToHex(saltBytes),
    address: predictCreate2(opts.deployer, bytesToHex(saltBytes), opts.initCodeHash),
    attempts: maxAttempts,
    found: false,
    ms: Date.now() - t0,
  };
}

/**
 * Bot legs are deployed with plain CREATE from LegDeployerV2, so their
 * addresses are its next nonces. Predicting them lets bot campaigns grind
 * too; if another bot campaign lands between the grind and the
 * transaction the prediction shifts and the address simply misses the
 * signature. Cosmetic only — the campaign itself is unaffected.
 */
export function predictLegAddresses(legDeployer: Address, nonce: bigint, wantBurn: boolean, wantLp: boolean): {
  burnLeg: Address;
  lpLeg: Address;
} {
  const zero = '0x0000000000000000000000000000000000000000' as Address;
  let n = nonce;
  const burnLeg = wantBurn ? getContractAddress({ from: legDeployer, nonce: n++ }) : zero;
  const lpLeg = wantLp ? getContractAddress({ from: legDeployer, nonce: n++ }) : zero;
  return { burnLeg, lpLeg };
}

/** Does this address wear the signature? */
export function hasSignature(address: Address, suffix: string = SIGNATURE_SUFFIX): boolean {
  return address.toLowerCase().endsWith(suffix.toLowerCase());
}
