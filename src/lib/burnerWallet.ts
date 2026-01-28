import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

// Message to sign for proving wallet ownership
const SIGN_MESSAGE_PREFIX = 'ProofLaunch Backing Verification\n\nMeme ID: ';

/**
 * Generates a fresh Solana keypair for use as a burner wallet
 */
export function generateBurnerKeypair(): Keypair {
  return Keypair.generate();
}

/**
 * Creates the message that the user's main wallet must sign
 * to prove they own the wallet backing this meme
 */
export function getSignMessage(memeId: string): string {
  return `${SIGN_MESSAGE_PREFIX}${memeId}\n\nBy signing, you confirm you are backing this meme with a token wallet.`;
}

/**
 * Full flow: generate keypair
 * Private key is sent to server in plain (over HTTPS) for server-side storage
 * Server encrypts with its own key for database storage
 */
export function createBurnerWallet(): {
  publicKey: string;
  privateKey: string;  // Base58 encoded - sent to server over HTTPS
  keypair: Keypair;
} {
  const keypair = generateBurnerKeypair();

  return {
    publicKey: keypair.publicKey.toBase58(),
    privateKey: bs58.encode(keypair.secretKey),
    keypair,
  };
}

/**
 * Export burner wallet private key as importable format (base58)
 * User can import this into Phantom/Solflare
 */
export function exportPrivateKey(keypair: Keypair): string {
  return bs58.encode(keypair.secretKey);
}
