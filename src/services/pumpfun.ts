import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram, TransactionInstruction, VersionedTransaction, TransactionMessage, ComputeBudgetProgram } from '@solana/web3.js';
import { PumpFunSDK } from 'pumpdotfun-sdk';
import { AnchorProvider } from '@coral-xyz/anchor';
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider';
import bs58 from 'bs58';
import { LaunchLogger, noopLaunchLogger } from '@/lib/launchLog';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

// Simple wallet implementation for AnchorProvider
class NodeWallet implements WalletInterface {
  constructor(readonly payer: Keypair) {}

  get publicKey(): PublicKey {
    return this.payer.publicKey;
  }

  async signTransaction<T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(tx: T): Promise<T> {
    if ('partialSign' in tx) {
      tx.partialSign(this.payer);
    } else if ('sign' in tx && typeof (tx as any).sign === 'function') {
      (tx as any).sign([this.payer]);
    }
    return tx;
  }

  async signAllTransactions<T extends import('@solana/web3.js').Transaction | import('@solana/web3.js').VersionedTransaction>(txs: T[]): Promise<T[]> {
    return txs.map((tx) => {
      if ('partialSign' in tx) {
        tx.partialSign(this.payer);
      } else if ('sign' in tx && typeof (tx as any).sign === 'function') {
        (tx as any).sign([this.payer]);
      }
      return tx;
    });
  }
}

// Platform configuration
const PLATFORM_FEE_BPS = 200; // 2% platform fee on total backing
const PLATFORM_WALLET = process.env.PLATFORM_WALLET_ADDRESS || 'CZnvVTTutAF7QTh5reQqRHE5i8J9cm1CWwaiQXi3QaXm';
const ESCROW_PRIVATE_KEY = process.env.ESCROW_WALLET_PRIVATE_KEY!;
const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Pump.fun program addresses (mainnet)
const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMP_FEE_PROGRAM_ID = new PublicKey('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
const PUMP_GLOBAL_ADDRESS = new PublicKey('4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf');
const PUMP_FEE_RECIPIENT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');

// Derive volume accumulator PDAs
function deriveGlobalVolumeAccumulator(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('global_volume_accumulator')],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function deriveUserVolumeAccumulator(user: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('user_volume_accumulator'), user.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function deriveBondingCurve(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

// pump.fun program upgrade (May 2026): buy/sell now require a V2 bonding
// curve PDA + a buyback fee recipient appended as remaining accounts.
// Omitting them throws AnchorError 6062 BuybackFeeRecipientMissing.
// Verified against @pump-fun/pump-sdk and cross-checked on live mainnet buys.
function deriveBondingCurveV2(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve-v2'), mint.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

// Current pump.fun buyback fee recipients (from @pump-fun/pump-sdk
// CURRENT_FEE_RECIPIENTS_FOR_BUYBACK). One is picked at random per buy,
// matching SDK behavior.
// Exported read-only so the drift detector can verify these against
// authoritative sources. Exporting does not change launch behavior.
export const EXPECTED_PUMP_BUY_ACCOUNT_COUNT = 18;
export const BUYBACK_FEE_RECIPIENTS = [
  '5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD',
  '9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7',
  'GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL',
  '3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR',
  '5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6',
  'EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL',
  '5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD',
  'A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW',
].map((a) => new PublicKey(a));

function getBuybackFeeRecipient(): PublicKey {
  return BUYBACK_FEE_RECIPIENTS[
    Math.floor(Math.random() * BUYBACK_FEE_RECIPIENTS.length)
  ];
}

function deriveCreatorVault(creator: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('creator-vault'), creator.toBuffer()],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function deriveEventAuthority(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('__event_authority')],
    PUMP_PROGRAM_ID
  );
  return pda;
}

function deriveFeeConfig(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('fee_config'), PUMP_PROGRAM_ID.toBuffer()],
    PUMP_FEE_PROGRAM_ID
  );
  return pda;
}

// Bonding curve account data structure
interface BondingCurveData {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean;
  creator: PublicKey;
}

// Parse bonding curve account data
function parseBondingCurve(data: Buffer): BondingCurveData {
  // Skip 8-byte discriminator
  let offset = 8;

  const virtualTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const virtualSolReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const realTokenReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const realSolReserves = data.readBigUInt64LE(offset);
  offset += 8;
  const tokenTotalSupply = data.readBigUInt64LE(offset);
  offset += 8;
  const complete = data.readUInt8(offset) === 1;
  offset += 1;
  const creator = new PublicKey(data.subarray(offset, offset + 32));

  return {
    virtualTokenReserves,
    virtualSolReserves,
    realTokenReserves,
    realSolReserves,
    tokenTotalSupply,
    complete,
    creator,
  };
}

// Calculate token amount from SOL using bonding curve formula
function calculateBuyTokenAmount(
  bondingCurve: BondingCurveData,
  solAmount: bigint
): bigint {
  // Formula: tokens = (sol * virtualTokenReserves) / (virtualSolReserves + sol)
  const numerator = solAmount * bondingCurve.virtualTokenReserves;
  const denominator = bondingCurve.virtualSolReserves + solAmount;
  return numerator / denominator;
}

// Build buy instruction with volume accumulators (new pump.fun requirement as of Aug 2025)
// Account order from pump.fun IDL: global, feeRecipient, mint, bondingCurve, associatedBondingCurve,
// associatedUser, user, systemProgram, tokenProgram, creatorVault, eventAuthority, program,
// globalVolumeAccumulator, userVolumeAccumulator, feeConfig, feeProgram
function buildBuyInstruction(
  user: PublicKey,
  mint: PublicKey,
  bondingCurve: PublicKey,
  associatedBondingCurve: PublicKey,
  associatedUser: PublicKey,
  creator: PublicKey,
  amount: bigint,
  maxSolCost: bigint
): TransactionInstruction {
  // Buy instruction discriminator (from pump.fun IDL)
  const discriminator = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]);

  // Encode arguments: amount (u64), maxSolCost (u64), trackVolume (Option<bool> = Some(true))
  const data = Buffer.alloc(8 + 8 + 8 + 2);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(amount, 8);
  data.writeBigUInt64LE(maxSolCost, 16);
  // trackVolume = Some(true) encoded as [1, 1] (Some = 1, true = 1)
  data.writeUInt8(1, 24);
  data.writeUInt8(1, 25);

  // 18 accounts: 16 from the published IDL + 2 appended remaining
  // accounts required by the May 2026 program upgrade (see above).
  const keys = [
    { pubkey: PUMP_GLOBAL_ADDRESS, isSigner: false, isWritable: false },           // 0: global
    { pubkey: PUMP_FEE_RECIPIENT, isSigner: false, isWritable: true },              // 1: feeRecipient
    { pubkey: mint, isSigner: false, isWritable: false },                           // 2: mint
    { pubkey: bondingCurve, isSigner: false, isWritable: true },                    // 3: bondingCurve
    { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },          // 4: associatedBondingCurve
    { pubkey: associatedUser, isSigner: false, isWritable: true },                  // 5: associatedUser
    { pubkey: user, isSigner: true, isWritable: true },                             // 6: user
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },        // 7: systemProgram
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },               // 8: tokenProgram
    { pubkey: deriveCreatorVault(creator), isSigner: false, isWritable: true },     // 9: creatorVault
    { pubkey: deriveEventAuthority(), isSigner: false, isWritable: false },         // 10: eventAuthority
    { pubkey: PUMP_PROGRAM_ID, isSigner: false, isWritable: false },                // 11: program
    { pubkey: deriveGlobalVolumeAccumulator(), isSigner: false, isWritable: false },// 12: globalVolumeAccumulator
    { pubkey: deriveUserVolumeAccumulator(user), isSigner: false, isWritable: true },// 13: userVolumeAccumulator
    { pubkey: deriveFeeConfig(), isSigner: false, isWritable: false },              // 14: feeConfig
    { pubkey: PUMP_FEE_PROGRAM_ID, isSigner: false, isWritable: false },            // 15: feeProgram
    // Remaining accounts added by the May 2026 pump.fun program upgrade.
    // Not declared in the published IDL (stale) but required by the
    // deployed program — absence => error 6062 BuybackFeeRecipientMissing.
    { pubkey: deriveBondingCurveV2(mint), isSigner: false, isWritable: false },     // 16: bondingCurveV2
    { pubkey: getBuybackFeeRecipient(), isSigner: false, isWritable: true },        // 17: buybackFeeRecipient
  ];

  return new TransactionInstruction({
    keys,
    programId: PUMP_PROGRAM_ID,
    data,
  });
}

export interface LaunchConfig {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  totalBackingSol: number;
  creatorWallet: string;
}

// Backer with timestamp for ordered execution
export interface BackerWithTimestamp {
  wallet: string;
  amountSol: number;
  backedAt: Date;
}

export interface LaunchResult {
  success: boolean;
  mintAddress?: string;
  signature?: string;
  pumpFunUrl?: string;
  error?: string;
}

// Get escrow wallet keypair
function getEscrowWallet(): Keypair {
  const secretKey = bs58.decode(ESCROW_PRIVATE_KEY);
  return Keypair.fromSecretKey(secretKey);
}

// Create PumpFun SDK instance
async function createPumpFunSDK(): Promise<PumpFunSDK> {
  const connection = new Connection(RPC_URL, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 120000, // 2 minutes
  });
  const escrowWallet = getEscrowWallet();
  const wallet = new NodeWallet(escrowWallet);

  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });

  return new PumpFunSDK(provider);
}

// Upload metadata to IPFS via pump.fun
async function uploadMetadata(config: LaunchConfig): Promise<{ metadataUri: string }> {
  // Fetch the image
  const imageResponse = await fetch(config.imageUrl);
  const imageBlob = await imageResponse.blob();

  // Create form data for pump.fun IPFS upload
  const formData = new FormData();
  formData.append('file', imageBlob, 'token.png');
  formData.append('name', config.name);
  formData.append('symbol', config.symbol);
  formData.append('description', config.description);
  formData.append('showName', 'true');

  if (config.twitter) formData.append('twitter', config.twitter);
  if (config.telegram) formData.append('telegram', config.telegram);
  if (config.website) formData.append('website', config.website);

  const response = await fetch('https://pump.fun/api/ipfs', {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Failed to upload metadata: ${response.statusText}`);
  }

  const result = await response.json();
  return { metadataUri: result.metadataUri };
}

// Calculate platform fee - taken from total backing
function calculatePlatformFee(totalBackingSol: number): number {
  return (totalBackingSol * PLATFORM_FEE_BPS) / 10000;
}

// Create token on pump.fun with ZERO dev buy
// This is step 1 of the new launch flow - creates the token without any initial purchase
export async function createTokenOnly(config: LaunchConfig): Promise<LaunchResult> {
  try {
    console.log(`Creating token (0 dev buy): ${config.name} (${config.symbol})`);

    // 1. Upload metadata to IPFS
    console.log('Uploading metadata to IPFS...');
    const { metadataUri } = await uploadMetadata(config);
    console.log('Metadata URI:', metadataUri);

    // 2. Create SDK and mint keypair
    const sdk = await createPumpFunSDK();
    const mintKeypair = Keypair.generate();
    const escrowWallet = getEscrowWallet();

    // 3. Fetch the image as a File object for the SDK
    const imageResponse = await fetch(config.imageUrl);
    const imageBlob = await imageResponse.blob();
    const imageFile = new File([imageBlob], 'token.png', { type: 'image/png' });

    // 4. Create token with 0 SOL buy - NO DEV BAG!
    console.log('Creating token on pump.fun with 0 dev buy...');
    console.log('Mint keypair (pre-create):', mintKeypair.publicKey.toBase58());

    const result = await sdk.createAndBuy(
      escrowWallet,
      mintKeypair,
      {
        name: config.name,
        symbol: config.symbol,
        description: config.description,
        file: imageFile,
        twitter: config.twitter,
        telegram: config.telegram,
        website: config.website,
      },
      BigInt(0), // ZERO dev buy - bullish signal!
      BigInt(500),
      {
        unitLimit: 500000,
        unitPrice: 500000,
      }
    );

    // CHECK if SDK actually succeeded before declaring success
    if (!result.success) {
      console.error('SDK createAndBuy failed:', result.error);
      return {
        success: false,
        error: result.error?.toString() || 'SDK createAndBuy returned success=false',
      };
    }

    console.log('Token CONFIRMED on pump.fun! Mint:', mintKeypair.publicKey.toBase58());
    console.log('Signature:', result.signature);

    return {
      success: true,
      mintAddress: mintKeypair.publicKey.toBase58(),
      signature: result.signature,
      pumpFunUrl: `https://pump.fun/coin/${mintKeypair.publicKey.toBase58()}`,
    };
  } catch (error) {
    console.error('Token creation failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Execute a buy on pump.fun and transfer tokens to backer
// This creates organic-looking buy activity from multiple sequential purchases
export interface BuyAndTransferResult {
  wallet: string;
  amountSol: number;
  tokensReceived: number;
  buySignature?: string;
  transferSignature?: string;
  error?: string;
}

export async function buyAndTransferToBacker(
  mintAddress: string,
  backerWallet: string,
  amountSol: number
): Promise<BuyAndTransferResult> {
  try {
    const sdk = await createPumpFunSDK();
    const escrowWallet = getEscrowWallet();
    const connection = new Connection(RPC_URL, 'confirmed');
    const mintPubkey = new PublicKey(mintAddress);
    const backerPubkey = new PublicKey(backerWallet);

    // 1. Get escrow's current token balance before buy
    const escrowTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      escrowWallet.publicKey
    );

    let balanceBefore = BigInt(0);
    try {
      const accountInfo = await getAccount(connection, escrowTokenAccount);
      balanceBefore = accountInfo.amount;
    } catch {
      // Account doesn't exist yet, balance is 0
    }

    // 2. Execute buy on pump.fun
    console.log(`Executing buy of ${amountSol} SOL for backer ${backerWallet}...`);
    const buyResult = await sdk.buy(
      escrowWallet,
      mintPubkey,
      BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL)),
      BigInt(1000), // 10% slippage (price moves with each buy)
      {
        unitLimit: 300000,
        unitPrice: 300000,
      }
    );

    if (!buyResult.success) {
      throw new Error(buyResult.error?.toString() || 'Buy failed');
    }

    console.log(`Buy successful: ${buyResult.signature}`);

    // 3. Wait a moment for state to update
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 4. Get new balance to calculate tokens received
    let tokensReceived = BigInt(0);
    try {
      const accountInfo = await getAccount(connection, escrowTokenAccount);
      tokensReceived = accountInfo.amount - balanceBefore;
    } catch (err) {
      console.error('Failed to get token balance:', err);
    }

    // 5. Transfer tokens to backer's wallet
    const backerTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      backerPubkey
    );

    const transaction = new Transaction();

    // Check if backer's token account exists
    const backerAccountInfo = await connection.getAccountInfo(backerTokenAccount);
    if (!backerAccountInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          escrowWallet.publicKey,
          backerTokenAccount,
          backerPubkey,
          mintPubkey
        )
      );
    }

    // Add transfer instruction
    transaction.add(
      createTransferInstruction(
        escrowTokenAccount,
        backerTokenAccount,
        escrowWallet.publicKey,
        tokensReceived
      )
    );

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = escrowWallet.publicKey;

    const transferSignature = await connection.sendTransaction(transaction, [escrowWallet]);
    console.log(`Transferred ${tokensReceived} tokens to ${backerWallet}: ${transferSignature}`);

    return {
      wallet: backerWallet,
      amountSol,
      tokensReceived: Number(tokensReceived),
      buySignature: buyResult.signature,
      transferSignature,
    };
  } catch (error) {
    console.error(`Buy/transfer failed for ${backerWallet}:`, error);
    return {
      wallet: backerWallet,
      amountSol,
      tokensReceived: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Execute the full launch: create token, then buy for each backer in order
// Earlier backers get better prices (lower on bonding curve) - rewards early conviction!
export async function launchWithBackerBuys(
  config: LaunchConfig,
  backers: BackerWithTimestamp[]
): Promise<{
  success: boolean;
  mintAddress?: string;
  pumpFunUrl?: string;
  createSignature?: string;
  buyResults: BuyAndTransferResult[];
  platformFeeSignature?: string;
  error?: string;
}> {
  const buyResults: BuyAndTransferResult[] = [];

  try {
    // 1. Calculate and take platform fee first
    const platformFeeSol = calculatePlatformFee(config.totalBackingSol);
    console.log(`Total backing: ${config.totalBackingSol} SOL`);
    console.log(`Platform fee (2%): ${platformFeeSol} SOL`);

    const connection = new Connection(RPC_URL, 'confirmed');
    const escrowWallet = getEscrowWallet();
    let platformFeeSignature: string | undefined;

    try {
      const platformFeeLamports = Math.floor(platformFeeSol * LAMPORTS_PER_SOL);
      const platformPubkey = new PublicKey(PLATFORM_WALLET);

      const feeTransaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: escrowWallet.publicKey,
          toPubkey: platformPubkey,
          lamports: platformFeeLamports,
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      feeTransaction.recentBlockhash = blockhash;
      feeTransaction.feePayer = escrowWallet.publicKey;

      platformFeeSignature = await connection.sendTransaction(feeTransaction, [escrowWallet]);
      console.log(`Platform fee sent: ${platformFeeSignature}`);
    } catch (feeError) {
      console.error('Platform fee transfer failed:', feeError);
      // Continue anyway - don't fail launch for fee transfer
    }

    // 2. Create token with 0 dev buy
    const createResult = await createTokenOnly(config);
    if (!createResult.success || !createResult.mintAddress) {
      return {
        success: false,
        buyResults: [],
        error: createResult.error || 'Token creation failed',
      };
    }

    console.log(`Token created: ${createResult.mintAddress}`);
    console.log(`Executing buys for ${backers.length} backers in order of backing time...`);

    // 3. Sort backers by backing time (earliest first - they get best prices!)
    const sortedBackers = [...backers].sort(
      (a, b) => new Date(a.backedAt).getTime() - new Date(b.backedAt).getTime()
    );

    // 4. Execute buys for each backer sequentially
    // Each buy moves the price up slightly, so earlier backers get more tokens
    for (let i = 0; i < sortedBackers.length; i++) {
      const backer = sortedBackers[i];
      console.log(`[${i + 1}/${sortedBackers.length}] Buying for ${backer.wallet} (${backer.amountSol} SOL)...`);

      const result = await buyAndTransferToBacker(
        createResult.mintAddress,
        backer.wallet,
        backer.amountSol
      );
      buyResults.push(result);

      // Small delay between buys to avoid rate limiting
      if (i < sortedBackers.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    }

    const successfulBuys = buyResults.filter(r => r.buySignature);
    console.log(`Launch complete! ${successfulBuys.length}/${backers.length} buys successful`);

    return {
      success: true,
      mintAddress: createResult.mintAddress,
      pumpFunUrl: createResult.pumpFunUrl,
      createSignature: createResult.signature,
      buyResults,
      platformFeeSignature,
    };
  } catch (error) {
    console.error('Launch failed:', error);
    return {
      success: false,
      buyResults,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Legacy function for backwards compatibility - redirects to new flow
export async function launchToken(config: LaunchConfig): Promise<LaunchResult> {
  // This is now deprecated - use launchWithBackerBuys instead
  // Keeping for backwards compatibility but it will create with 0 dev buy
  console.warn('launchToken is deprecated. Use launchWithBackerBuys for the new flow.');
  return createTokenOnly(config);
}

// Check escrow wallet balance
export async function getEscrowBalance(): Promise<number> {
  const connection = new Connection(RPC_URL, 'confirmed');
  const escrowWallet = getEscrowWallet();
  const balance = await connection.getBalance(escrowWallet.publicKey);
  return balance / LAMPORTS_PER_SOL;
}

// Get escrow wallet address
export function getEscrowAddress(): string {
  const escrowWallet = getEscrowWallet();
  return escrowWallet.publicKey.toBase58();
}

// Verify a SOL deposit to escrow
export async function verifyDeposit(
  signature: string,
  expectedAmount: number,
  fromWallet: string
): Promise<boolean> {
  try {
    // Use the Helius RPC URL from environment
    const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    console.log('=== VERIFY DEPOSIT START ===');
    console.log('RPC URL:', rpcUrl);
    console.log('Signature:', signature);
    console.log('Expected amount:', expectedAmount, 'SOL');
    console.log('From wallet:', fromWallet);

    const connection = new Connection(rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });

    // Retry logic with exponential backoff for transaction confirmation
    const maxRetries = 5;
    let tx = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Wait before each attempt (increasing delays)
      const waitTime = (attempt + 1) * 2000; // 2s, 4s, 6s, 8s, 10s
      console.log(`Attempt ${attempt + 1}/${maxRetries}: waiting ${waitTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));

      tx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (tx && tx.meta) {
        console.log('Transaction found on attempt', attempt + 1);
        break;
      }

      console.log('Transaction not found yet...');
    }

    if (!tx) {
      console.log('Transaction not found after all retries');
      return false;
    }

    if (!tx.meta) {
      console.log('Transaction has no meta');
      return false;
    }

    return verifyTransactionDetails(tx, expectedAmount, fromWallet);
  } catch (error) {
    console.error('Failed to verify deposit:', error);
    return false;
  }
}

// Helper to verify transaction details
// The deposit tx sends backing amount to burner wallet + platform fee to escrow.
// We verify the sender spent at least expectedAmount and escrow received its fee.
function verifyTransactionDetails(tx: any, expectedAmount: number, fromWallet: string): boolean {
  const escrowWallet = getEscrowWallet();
  const escrowAddress = escrowWallet.publicKey.toBase58();

  const accountKeys = tx.transaction.message.getAccountKeys();
  const allKeys = accountKeys.staticAccountKeys.map((k: PublicKey) => k.toBase58());
  console.log('Transaction accounts:', allKeys);

  // Find sender in transaction
  const senderIndex = allKeys.findIndex((key: string) => key === fromWallet);
  if (senderIndex === -1) {
    console.log('Sender wallet not found in transaction');
    return false;
  }

  // Find escrow in transaction
  const escrowIndex = allKeys.findIndex((key: string) => key === escrowAddress);
  if (escrowIndex === -1) {
    console.log('Escrow wallet not found in transaction');
    return false;
  }

  // Check sender's balance decrease (backing amount + platform fee + tx fees)
  const senderPre = tx.meta.preBalances[senderIndex];
  const senderPost = tx.meta.postBalances[senderIndex];
  const senderSpentLamports = senderPre - senderPost;
  const senderSpentSol = senderSpentLamports / LAMPORTS_PER_SOL;

  // Check escrow received platform fee
  const escrowPre = tx.meta.preBalances[escrowIndex];
  const escrowPost = tx.meta.postBalances[escrowIndex];
  const escrowReceivedSol = (escrowPost - escrowPre) / LAMPORTS_PER_SOL;

  // Expected platform fee: 2%
  const expectedFee = expectedAmount * 0.02;

  console.log('Sender spent:', senderSpentSol.toFixed(6), 'SOL (expected >=', expectedAmount, '+ fee)');
  console.log('Escrow received:', escrowReceivedSol.toFixed(6), 'SOL (expected ~', expectedFee.toFixed(4), ')');

  // Sender must have spent at least the backing amount (they also pay fee + tx costs)
  const senderValid = senderSpentSol >= expectedAmount * 0.99; // 1% tolerance for rounding
  // Escrow must have received approximately the platform fee
  const escrowValid = escrowReceivedSol >= expectedFee * 0.95; // 5% tolerance

  const isValid = senderValid && escrowValid;
  console.log('Verification result:', isValid, '(sender:', senderValid, 'escrow:', escrowValid, ')');
  return isValid;
}

// Refund SOL to a backer (if meme fails to launch)
export async function refundBacker(
  backerWallet: string,
  amountSol: number
): Promise<{ success: boolean; signature?: string; error?: string }> {
  try {
    console.log(`=== REFUND START ===`);
    console.log(`Refunding ${amountSol} SOL to ${backerWallet}`);
    console.log(`RPC URL: ${RPC_URL}`);

    const connection = new Connection(RPC_URL, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });
    const escrowWallet = getEscrowWallet();
    console.log(`Escrow wallet: ${escrowWallet.publicKey.toBase58()}`);

    const { SystemProgram } = await import('@solana/web3.js');

    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);
    console.log(`Lamports to transfer: ${lamports}`);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: escrowWallet.publicKey,
        toPubkey: new PublicKey(backerWallet),
        lamports,
      })
    );

    // Get recent blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = escrowWallet.publicKey;

    console.log(`Sending transaction...`);
    const signature = await connection.sendTransaction(transaction, [escrowWallet]);
    console.log(`Transaction sent: ${signature}`);

    // Don't wait for confirmation - it can timeout
    // The transaction is already submitted
    console.log(`Refund complete: ${signature}`);

    return { success: true, signature };
  } catch (error) {
    console.error('Refund error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Backer info for distribution
export interface BackerInfo {
  wallet: string;
  amountSol: number;
}

// Burner wallet backer info (for new launch flow)
export interface BurnerBackerInfo {
  mainWallet: string;           // User's main wallet (for tracking)
  burnerWallet: string;         // Burner wallet public key
  encryptedPrivateKey: string;  // Server-side encrypted private key
  amountSol: number;            // Amount in burner wallet
  backedAt: Date;               // For ordering
}

// Result for burner wallet buy
export interface BurnerBuyResult {
  mainWallet: string;
  burnerWallet: string;
  amountSol: number;
  tokensReceived: number;
  buySignature?: string;
  error?: string;
}

// Jito block engine endpoints (try multiple to avoid rate limits)
const JITO_BUNDLE_URLS = [
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://ny.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://frankfurt.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
];

// === JITO BUNDLE SUPPORT ===

// Jito tip accounts (mainnet) - one is randomly selected per bundle.
// Verified against Jito's authoritative getTipAccounts RPC (May 2026).
// 2 prior entries were stale; a stale tip account makes Jito reject the
// bundle with "must write lock at least one tip account".
export const JITO_TIP_ACCOUNTS = [
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
];

function getRandomJitoTipAccount(): PublicKey {
  return new PublicKey(JITO_TIP_ACCOUNTS[Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length)]);
}

// Bonding curve state used for simulation and logging
interface PredictedCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
}

// Fetch initial curve constants from pump.fun global account (on-chain)
async function fetchInitialCurveConstants(sdk: PumpFunSDK): Promise<PredictedCurveState> {
  const globalAccount = await sdk.getGlobalAccount();
  return {
    virtualTokenReserves: globalAccount.initialVirtualTokenReserves,
    virtualSolReserves: globalAccount.initialVirtualSolReserves,
    realTokenReserves: globalAccount.initialRealTokenReserves,
    realSolReserves: BigInt(0),
  };
}

// Simulate a buy on the bonding curve - returns tokens out and new state
// Uses same formula as pump.fun's on-chain program
function simulateBuy(
  state: PredictedCurveState,
  solAmountLamports: bigint
): { tokensOut: bigint; newState: PredictedCurveState } {
  const n = state.virtualSolReserves * state.virtualTokenReserves;
  const i = state.virtualSolReserves + solAmountLamports;
  const r = n / i + BigInt(1);
  const s = state.virtualTokenReserves - r;
  const tokensOut = s < state.realTokenReserves ? s : state.realTokenReserves;

  return {
    tokensOut,
    newState: {
      virtualTokenReserves: state.virtualTokenReserves - tokensOut,
      virtualSolReserves: state.virtualSolReserves + solAmountLamports,
      realTokenReserves: state.realTokenReserves - tokensOut,
      realSolReserves: state.realSolReserves + solAmountLamports,
    },
  };
}

// Calculate available SOL for a buy after accounting for all fees/reserves
function calculateBundledBuyAmount(burnerBalanceLamports: number): bigint {
  // Same deductions as executeBurnerBuy
  const ataRent = 2_039_280; // Always needed - new token
  const walletRentExempt = 890_880;
  const reserveForTransfer = 2_550_000;
  const baseTxFee = 5_000;
  const priorityFee = 5_000;

  const afterFixedCosts = burnerBalanceLamports - ataRent - walletRentExempt
    - reserveForTransfer - baseTxFee - priorityFee;
  // Pump.fun charges ~1% on buys. The 1.05 divisor gives ~5% headroom between
  // buyAmount and maxSolCost, tolerating small sniper buys (~0.75 SOL) in the
  // brief window between curve read and tx landing. Retry handles anything larger.
  const availableForBuy = Math.floor(afterFixedCosts / 1.05);
  return availableForBuy > 0 ? BigInt(availableForBuy) : BigInt(0);
}

// Build token creation as a VersionedTransaction
// Optional Jito tip parameter kept for backwards compatibility but no longer used
async function buildCreationVersionedTx(
  sdk: PumpFunSDK,
  escrowKeypair: Keypair,
  mintKeypair: Keypair,
  metadataUri: string,
  config: LaunchConfig,
  blockhash: string,
  jitoTipLamports: number = 0 // Embed tip in create tx to save a slot
): Promise<VersionedTransaction> {
  // Get raw create instructions from SDK (doesn't send)
  const createTx = await sdk.getCreateInstructions(
    escrowKeypair.publicKey,
    config.name,
    config.symbol,
    metadataUri,
    mintKeypair
  );

  // Build full transaction with compute budget for priority
  const fullTx = new Transaction();
  fullTx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 500000 })
  );
  fullTx.add(...createTx.instructions);

  // Add Jito tip instruction if provided (saves a transaction slot)
  if (jitoTipLamports > 0) {
    const tipAccount = getRandomJitoTipAccount();
    fullTx.add(
      SystemProgram.transfer({
        fromPubkey: escrowKeypair.publicKey,
        toPubkey: tipAccount,
        lamports: jitoTipLamports,
      })
    );
    console.log(`Jito tip of ${jitoTipLamports / LAMPORTS_PER_SOL} SOL embedded in create tx`);
  }

  // Convert to VersionedTransaction
  const messageV0 = new TransactionMessage({
    payerKey: escrowKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: fullTx.instructions,
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(messageV0);
  versionedTx.sign([escrowKeypair, mintKeypair]);

  return versionedTx;
}

// Build a burner wallet buy as a VersionedTransaction for Jito bundle
// Uses predicted bonding curve state instead of fetching from chain
async function buildBundledBuyVersionedTx(
  burnerKeypair: Keypair,
  mintPubkey: PublicKey,
  creatorPubkey: PublicKey,
  solAmountLamports: bigint,
  predictedTokensOut: bigint,
  blockhash: string
): Promise<VersionedTransaction> {
  const bondingCurvePda = deriveBondingCurve(mintPubkey);
  const associatedBondingCurve = await getAssociatedTokenAddress(
    mintPubkey,
    bondingCurvePda,
    true
  );
  const associatedUser = await getAssociatedTokenAddress(
    mintPubkey,
    burnerKeypair.publicKey
  );

  const tx = new Transaction();

  // Compute budget with higher priority for bundle
  tx.add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 })
  );

  // Always create ATA (token is brand new in the same bundle)
  tx.add(
    createAssociatedTokenAccountInstruction(
      burnerKeypair.publicKey,
      associatedUser,
      burnerKeypair.publicKey,
      mintPubkey
    )
  );

  // Buy instruction - generous 50% slippage since bundle is atomic (no external trades possible)
  const maxSolCost = (solAmountLamports * BigInt(150)) / BigInt(100);
  tx.add(
    buildBuyInstruction(
      burnerKeypair.publicKey,
      mintPubkey,
      bondingCurvePda,
      associatedBondingCurve,
      associatedUser,
      creatorPubkey,
      predictedTokensOut,
      maxSolCost
    )
  );

  // Convert to VersionedTransaction
  const messageV0 = new TransactionMessage({
    payerKey: burnerKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: tx.instructions,
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(messageV0);
  versionedTx.sign([burnerKeypair]);

  return versionedTx;
}

// Build Jito tip transaction as VersionedTransaction
function buildJitoTipVersionedTx(
  escrowKeypair: Keypair,
  tipLamports: number,
  blockhash: string
): VersionedTransaction {
  const tipAccount = getRandomJitoTipAccount();

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: escrowKeypair.publicKey,
      toPubkey: tipAccount,
      lamports: tipLamports,
    })
  );

  const messageV0 = new TransactionMessage({
    payerKey: escrowKeypair.publicKey,
    recentBlockhash: blockhash,
    instructions: tx.instructions,
  }).compileToV0Message();

  const versionedTx = new VersionedTransaction(messageV0);
  versionedTx.sign([escrowKeypair]);

  return versionedTx;
}

// Submit a bundle of VersionedTransactions to Jito block engine
// Tries each regional endpoint, cycling through on 429 rate limits
async function submitJitoBundle(transactions: VersionedTransaction[]): Promise<string> {
  const encodedTxs = transactions.map(tx =>
    bs58.encode(Buffer.from(tx.serialize()))
  );

  const errors: string[] = [];

  for (let i = 0; i < JITO_BUNDLE_URLS.length; i++) {
    const url = JITO_BUNDLE_URLS[i];
    const region = url.split('//')[1].split('.')[0];
    console.log(`Submitting Jito bundle with ${transactions.length} transactions via ${region} (${i + 1}/${JITO_BUNDLE_URLS.length})...`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'sendBundle',
          params: [encodedTxs],
        }),
      });

      if (response.status === 429) {
        console.log(`Jito ${region} rate limited (429), trying next endpoint...`);
        errors.push(`${region}: 429 rate limited`);
        continue;
      }

      if (!response.ok) {
        const errorText = await response.text();
        errors.push(`${region}: ${response.status} ${errorText}`);
        continue;
      }

      const result = await response.json();
      if (result.error) {
        errors.push(`${region}: ${JSON.stringify(result.error)}`);
        continue;
      }

      console.log(`Jito bundle submitted via ${region}: ${result.result}`);
      return result.result; // Bundle ID
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      errors.push(`${region}: ${msg}`);
      continue;
    }
  }

  throw new Error(`Jito bundle failed on all endpoints: ${errors.join(' | ')}`);
}

// Poll Jito for bundle confirmation status
async function confirmJitoBundle(
  bundleId: string,
  timeoutMs: number = 60000
): Promise<{ landed: boolean; signatures?: string[] }> {
  const startTime = Date.now();
  const pollIntervalMs = 2000;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(JITO_BUNDLE_URLS[0], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getBundleStatuses',
          params: [[bundleId]],
        }),
      });

      const result = await response.json();
      const statuses = result?.result?.value;

      if (statuses?.length > 0) {
        const status = statuses[0];
        console.log(`Bundle ${bundleId} status:`, status.confirmation_status || 'pending');

        if (status.confirmation_status === 'confirmed' ||
            status.confirmation_status === 'finalized') {
          return { landed: true, signatures: status.transactions };
        }

        if (status.err) {
          console.error('Bundle failed with error:', status.err);
          return { landed: false };
        }
      }
    } catch (err) {
      console.warn('Bundle status poll error:', err);
    }

    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  console.warn(`Bundle ${bundleId} timed out after ${timeoutMs}ms`);
  return { landed: false };
}

// Execute buy from a burner wallet using custom instruction with volume accumulators
// This is required since pump.fun's Aug 2025 update added global_volume_accumulator and user_volume_accumulator
async function executeBurnerBuy(
  _sdk: PumpFunSDK, // Keep for compatibility but not used
  connection: Connection,
  burnerKeypair: Keypair,
  mintPubkey: PublicKey,
  amountSol: number
): Promise<{ signature?: string; tokensReceived: number; error?: string }> {
  try {
    console.log('=== executeBurnerBuy V8 - divide by 1.05 for fees ===');

    // Get actual burner wallet balance
    const burnerBalance = await connection.getBalance(burnerKeypair.publicKey);
    console.log('>>> Burner balance:', burnerBalance, 'lamports =', burnerBalance / LAMPORTS_PER_SOL, 'SOL');

    // Check if user's token account already exists
    const associatedUserCheck = await getAssociatedTokenAddress(
      mintPubkey,
      burnerKeypair.publicKey
    );
    const userTokenAccountExists = await connection.getAccountInfo(associatedUserCheck) !== null;
    console.log('>>> ATA exists:', userTokenAccountExists);

    // Instead of estimating fees, use a percentage-based approach
    // After ATA creation + fees, we typically have about 60% of balance left for 0.01 SOL
    // And about 80% for larger amounts (since ATA is fixed cost)
    // Let's be conservative and use what remains after accounting for all possible fees

    // Fixed costs with actual compute budget settings:
    // - ATA rent: 2,039,280 (if needed)
    // - Base tx fee: 5,000 lamports
    // - Priority fee: (100,000 CU * 50,000 microLamports) / 1,000,000 = 5,000 lamports
    // - Wallet rent-exempt minimum: 890,880 lamports (must stay in wallet)
    //
    // pump.fun fee: 1% protocol fee charged on SOL amount
    // We also set maxSolCost to 120% of buy amount for slippage protection
    //
    // Working backwards from test results:
    // 0.02 SOL wallet -> 16,056,164 available after all deductions
    // We tried 16,718,643 and failed
    // So the actual available is about 16,056,164 / 20,000,000 = ~80.3% of initial balance
    //
    // Let's calculate exactly what we can spend:
    // After tx fees (5000 + 5000 = 10,000) and ATA (2,039,280) = 2,049,280 deducted upfront
    // That leaves: 20,000,000 - 2,049,280 = 17,950,720
    // Then pump.fun takes 1% fee on the buy = ~169,500 for 16.9M buy
    // Plus we need rent-exempt 890,880 in wallet
    //
    // Available = (balance - txFees - ataRent - rentExempt) / 1.01 (for 1% pump fee)

    // Fixed costs that are deducted regardless of buy amount:
    const ataRent = userTokenAccountExists ? 0 : 2039280;
    // Reserve enough SOL for later token transfer to main wallet:
    // - ATA creation on main wallet: ~2,039,280 lamports
    // - Transfer tx fee: ~10,000 lamports
    // - Buffer: ~500,000 lamports
    // Total reserve: ~2,550,000 lamports (~0.00255 SOL)
    const reserveForTransfer = 2550000; // Reserve for claim tokens transfer
    const walletRentExempt = 890880; // Must keep wallet rent-exempt
    const baseTxFee = 5000;
    const priorityFee = 5000; // (100k CU * 50k microLamports) / 1M

    // What's left after all fixed costs (including reserve for later token transfer)
    const afterFixedCosts = burnerBalance - ataRent - walletRentExempt - reserveForTransfer - baseTxFee - priorityFee;

    // Pump.fun charges ~1% fee on buy amount. 1.05 divisor matches the batched
    // buy path — gives ~5% headroom for price movement while maximizing SOL usage.
    const availableForBuy = Math.floor(afterFixedCosts / 1.05);

    console.log('>>> Balance:', burnerBalance);
    console.log('>>> Fixed costs: ATA', ataRent, '+ rentExempt', walletRentExempt, '+ reserveForTransfer', reserveForTransfer, '+ fees', baseTxFee + priorityFee, '=', ataRent + walletRentExempt + reserveForTransfer + baseTxFee + priorityFee);
    console.log('>>> After fixed:', afterFixedCosts, '| Available (÷1.05):', availableForBuy, '=', availableForBuy / 1e9, 'SOL');

    if (availableForBuy <= 0) {
      return { tokensReceived: 0, error: `Insufficient balance: ${burnerBalance / LAMPORTS_PER_SOL} SOL` };
    }

    const buyAmountLamports = BigInt(availableForBuy);
    console.log('>>> Buy amount:', availableForBuy, 'lamports =', Number(buyAmountLamports) / LAMPORTS_PER_SOL, 'SOL');

    // Get bonding curve account to read creator and calculate token amount
    const bondingCurvePda = deriveBondingCurve(mintPubkey);
    console.log('Bonding curve PDA:', bondingCurvePda.toBase58());
    const bondingCurveAccount = await connection.getAccountInfo(bondingCurvePda);

    if (!bondingCurveAccount) {
      return { tokensReceived: 0, error: 'Bonding curve not found' };
    }

    const bondingCurveData = parseBondingCurve(bondingCurveAccount.data);
    console.log('Creator from bonding curve:', bondingCurveData.creator.toBase58());

    if (bondingCurveData.complete) {
      return { tokensReceived: 0, error: 'Bonding curve is complete - token has graduated' };
    }

    // Calculate expected token amount based on available SOL (not original backing amount)
    const expectedTokens = calculateBuyTokenAmount(bondingCurveData, buyAmountLamports);
    console.log('>>> Expected tokens for', Number(buyAmountLamports) / LAMPORTS_PER_SOL, 'SOL:', expectedTokens.toString());

    // maxSolCost = full afterFixedCosts (matches batched buy path)
    const maxSolCost = BigInt(afterFixedCosts);
    console.log('>>> Max SOL cost:', Number(maxSolCost) / LAMPORTS_PER_SOL, 'SOL');

    // Get associated token accounts
    const associatedBondingCurve = await getAssociatedTokenAddress(
      mintPubkey,
      bondingCurvePda,
      true // allowOwnerOffCurve for PDA
    );

    // Reuse the ATA we already checked above
    const associatedUser = associatedUserCheck;

    // Build transaction - compute budget FIRST
    const { ComputeBudgetProgram } = await import('@solana/web3.js');
    const transaction = new Transaction();

    // Add compute budget instructions first
    // Pump.fun buy with volume tracking needs ~75k compute units, but CPI calls need more headroom
    // Set to 400k for safety - the actual cost depends on bonding curve state
    transaction.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 })
    );

    // Create ATA if it doesn't exist (we already checked above for fee calculation)
    if (!userTokenAccountExists) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          burnerKeypair.publicKey,
          associatedUser,
          burnerKeypair.publicKey,
          mintPubkey
        )
      );
    }

    // Log volume accumulator PDAs
    const globalVolAcc = deriveGlobalVolumeAccumulator();
    const userVolAcc = deriveUserVolumeAccumulator(burnerKeypair.publicKey);
    console.log('Global volume accumulator PDA:', globalVolAcc.toBase58());
    console.log('User volume accumulator PDA:', userVolAcc.toBase58());

    // Add buy instruction with volume accumulators
    const buyIx = buildBuyInstruction(
      burnerKeypair.publicKey,
      mintPubkey,
      bondingCurvePda,
      associatedBondingCurve,
      associatedUser,
      bondingCurveData.creator,
      expectedTokens,
      maxSolCost
    );

    console.log('Buy instruction accounts count:', buyIx.keys.length);
    buyIx.keys.forEach((key, i) => {
      console.log(`  Account ${i}: ${key.pubkey.toBase58()} (signer: ${key.isSigner}, writable: ${key.isWritable})`);
    });

    transaction.add(buyIx);

    // Send transaction
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = burnerKeypair.publicKey;

    console.log('Sending transaction...');
    const signature = await connection.sendTransaction(transaction, [burnerKeypair], {
      skipPreflight: false,
      preflightCommitment: 'confirmed',
    });
    console.log('Transaction sent:', signature);

    // Wait for confirmation
    await connection.confirmTransaction({
      signature,
      blockhash,
      lastValidBlockHeight,
    }, 'confirmed');

    // Get token balance after buy
    let tokensReceived = 0;
    try {
      const accountInfo = await getAccount(connection, associatedUser);
      tokensReceived = Number(accountInfo.amount);
    } catch {
      // Account might not exist yet
    }

    return {
      signature,
      tokensReceived,
    };
  } catch (error) {
    console.error('executeBurnerBuy error:', error);
    return {
      tokensReceived: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Decrypt a burner wallet private key and return as Keypair
// Handles both legacy "enc:" and new "aes:" formats via shared crypto lib
function decryptBurnerKey(encryptedKey: string): Keypair {
  if (encryptedKey.startsWith('enc:') || encryptedKey.startsWith('aes:')) {
    const { decryptPrivateKey } = require('@/lib/crypto');
    const privateKeyStr = decryptPrivateKey(encryptedKey);
    return Keypair.fromSecretKey(bs58.decode(privateKeyStr));
  }

  // Fallback: assume it's already a base58 private key
  return Keypair.fromSecretKey(bs58.decode(encryptedKey));
}

// New launch flow with burner wallets
// 1. Create token with 0 dev buy
// 2. Execute buys from each burner wallet
// 3. Each backer's tokens stay in their burner wallet - they import it later
export async function launchWithBurnerWallets(
  config: LaunchConfig,
  burnerBackers: BurnerBackerInfo[]
): Promise<{
  success: boolean;
  mintAddress?: string;
  pumpFunUrl?: string;
  createSignature?: string;
  buyResults: BurnerBuyResult[];
  error?: string;
}> {
  const buyResults: BurnerBuyResult[] = [];

  try {
    console.log(`=== BURNER WALLET LAUNCH START ===`);
    console.log(`Token: ${config.name} (${config.symbol})`);
    console.log(`Backers: ${burnerBackers.length}`);
    console.log(`Total backing: ${config.totalBackingSol} SOL`);

    // 1. Create token with 0 dev buy
    console.log('Step 1: Creating token with 0 dev buy...');
    const createResult = await createTokenOnly(config);

    if (!createResult.success || !createResult.mintAddress) {
      return {
        success: false,
        buyResults: [],
        error: createResult.error || 'Token creation failed',
      };
    }

    console.log(`Token created: ${createResult.mintAddress}`);
    const mintPubkey = new PublicKey(createResult.mintAddress);

    // 2. Create SDK and connection for buys
    const sdk = await createPumpFunSDK();
    const connection = new Connection(RPC_URL, 'confirmed');

    // 3. Sort backers by backing time (earliest first = best price)
    const sortedBackers = [...burnerBackers].sort(
      (a, b) => new Date(a.backedAt).getTime() - new Date(b.backedAt).getTime()
    );

    console.log(`Step 2: Executing ${sortedBackers.length} burner wallet buys with staggered start...`);

    // 4. Execute buys from each burner wallet with STAGGERED START to avoid RPC rate limits
    // Each transaction starts 500ms after the previous one, but they run in parallel once started
    const STAGGER_DELAY_MS = 500; // 500ms between starting each transaction

    const buyPromises = sortedBackers.map(async (backer, i) => {
      // Stagger the start of each transaction to avoid 429 rate limits
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, i * STAGGER_DELAY_MS));
      }

      console.log(`[${i + 1}/${sortedBackers.length}] Starting buy from burner ${backer.burnerWallet.slice(0, 8)}...`);

      try {
        // Decrypt burner wallet (server-side encrypted)
        const burnerKeypair = decryptBurnerKey(backer.encryptedPrivateKey);

        // Verify the decrypted key matches the expected public key
        if (burnerKeypair.publicKey.toBase58() !== backer.burnerWallet) {
          return {
            mainWallet: backer.mainWallet,
            burnerWallet: backer.burnerWallet,
            amountSol: backer.amountSol,
            tokensReceived: 0,
            error: 'Decrypted key mismatch',
          };
        }

        // Execute buy from burner wallet
        const result = await executeBurnerBuy(
          sdk,
          connection,
          burnerKeypair,
          mintPubkey,
          backer.amountSol
        );

        if (result.signature) {
          console.log(`  [${i + 1}] Buy successful: ${result.tokensReceived} tokens`);
        } else {
          console.log(`  [${i + 1}] Buy failed: ${result.error}`);
        }

        return {
          mainWallet: backer.mainWallet,
          burnerWallet: backer.burnerWallet,
          amountSol: backer.amountSol,
          tokensReceived: result.tokensReceived,
          buySignature: result.signature,
          error: result.error,
        };
      } catch (err) {
        console.error(`  [${i + 1}] Error processing backer ${backer.mainWallet}:`, err);
        return {
          mainWallet: backer.mainWallet,
          burnerWallet: backer.burnerWallet,
          amountSol: backer.amountSol,
          tokensReceived: 0,
          error: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    });

    // Wait for all buys to complete
    const results = await Promise.all(buyPromises);
    buyResults.push(...results);

    const successfulBuys = buyResults.filter(r => r.buySignature);
    console.log(`=== LAUNCH COMPLETE ===`);
    console.log(`${successfulBuys.length}/${sortedBackers.length} buys successful`);

    return {
      success: successfulBuys.length > 0,
      mintAddress: createResult.mintAddress,
      pumpFunUrl: createResult.pumpFunUrl,
      createSignature: createResult.signature,
      buyResults,
    };
  } catch (error) {
    console.error('Launch with burner wallets failed:', error);
    return {
      success: false,
      buyResults,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Execute buys using standard flow with reduced stagger (used for overflow buys after bundle)
async function executeAllBuysStandard(
  sdk: PumpFunSDK,
  connection: Connection,
  mintPubkey: PublicKey,
  backers: BurnerBackerInfo[]
): Promise<BurnerBuyResult[]> {
  const STAGGER_DELAY_MS = 150; // Reduced from 500ms for speed

  const buyPromises = backers.map(async (backer, i) => {
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, i * STAGGER_DELAY_MS));
    }

    try {
      const burnerKeypair = decryptBurnerKey(backer.encryptedPrivateKey);
      if (burnerKeypair.publicKey.toBase58() !== backer.burnerWallet) {
        return {
          mainWallet: backer.mainWallet,
          burnerWallet: backer.burnerWallet,
          amountSol: backer.amountSol,
          tokensReceived: 0,
          error: 'Decrypted key mismatch',
        };
      }

      const result = await executeBurnerBuy(sdk, connection, burnerKeypair, mintPubkey, backer.amountSol);
      return {
        mainWallet: backer.mainWallet,
        burnerWallet: backer.burnerWallet,
        amountSol: backer.amountSol,
        tokensReceived: result.tokensReceived,
        buySignature: result.signature,
        error: result.error,
      };
    } catch (err) {
      return {
        mainWallet: backer.mainWallet,
        burnerWallet: backer.burnerWallet,
        amountSol: backer.amountSol,
        tokensReceived: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  });

  return Promise.all(buyPromises);
}

// Launch with batched RPC buys - reads actual on-chain curve state for reliable execution
// Genesis (slots 1-4) buy first, Wave 2 (slots 5-8) buy in second wave
// Pre-builds ALL buy transactions using predicted curve state, then:
//   1. Send create tx via RPC
//   2. Blast batch 1 (Genesis, slots 1-4) immediately after create confirms
//   3. Wait for batch 1, blast batch 2 (Wave 2, slots 5-8)
// Snipe window: ~200ms (time between create confirm and batch 1 sends)
export async function launchWithBatchedBuys(
  config: LaunchConfig,
  burnerBackers: BurnerBackerInfo[],
  log: LaunchLogger = noopLaunchLogger
): Promise<{
  success: boolean;
  mintAddress?: string;
  pumpFunUrl?: string;
  createSignature?: string;
  buyResults: BurnerBuyResult[];
  error?: string;
}> {
  const BATCH_SIZE = 4; // Genesis = first 4, Wave 2 = rest

  try {
    console.log(`=== BATCHED RPC LAUNCH START ===`);
    console.log(`Token: ${config.name} (${config.symbol})`);
    console.log(`Backers: ${burnerBackers.length}`);
    console.log(`Total backing: ${config.totalBackingSol} SOL`);

    // Sort backers by backing time (earliest first = best price)
    const sortedBackers = [...burnerBackers].sort(
      (a, b) => new Date(a.backedAt).getTime() - new Date(b.backedAt).getTime()
    );

    // Split into batches
    const batch1 = sortedBackers.slice(0, BATCH_SIZE); // Genesis
    const batch2 = sortedBackers.slice(BATCH_SIZE);     // Wave 2
    console.log(`Genesis (batch 1): ${batch1.length} | Wave 2 (batch 2): ${batch2.length}`);

    // === PHASE 1: Pre-compute everything in parallel ===
    console.log('Phase 1: Pre-computing metadata + curve constants + balances...');

    const escrowKeypair = getEscrowWallet();
    const mintKeypair = Keypair.generate();
    const sdk = await createPumpFunSDK();
    const connection = new Connection(RPC_URL, 'confirmed');

    // Run these in parallel - they're independent
    const [
      { metadataUri },
      initialCurveState,
      ...balances
    ] = await Promise.all([
      uploadMetadata(config),
      fetchInitialCurveConstants(sdk),
      ...sortedBackers.map(b => connection.getBalance(new PublicKey(b.burnerWallet))),
    ]);

    console.log(`Metadata uploaded: ${metadataUri}`);
    console.log(`Initial curve: vTokens=${initialCurveState.virtualTokenReserves}, vSol=${initialCurveState.virtualSolReserves}`);

    // === PHASE 2: Build create tx and decrypt keys ===
    console.log('Phase 2: Building create tx + decrypting burner keys...');

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

    // Build create tx
    const createTx = await buildCreationVersionedTx(
      sdk, escrowKeypair, mintKeypair, metadataUri, config, blockhash, 0
    );

    // Decrypt all burner keypairs upfront
    const burnerKeypairs = sortedBackers.map(b => {
      const keypair = decryptBurnerKey(b.encryptedPrivateKey);
      if (keypair.publicKey.toBase58() !== b.burnerWallet) {
        throw new Error(`Key mismatch for ${b.burnerWallet}`);
      }
      return keypair;
    });

    // Pre-derive PDAs that don't depend on curve state (saves time later)
    const mintPubkey = mintKeypair.publicKey;
    const bondingCurvePda = deriveBondingCurve(mintPubkey);
    const associatedBondingCurve = await getAssociatedTokenAddress(mintPubkey, bondingCurvePda, true);

    // Pre-derive all burner ATAs (no network needed)
    const burnerATAs = await Promise.all(
      burnerKeypairs.map(kp => getAssociatedTokenAddress(mintPubkey, kp.publicKey))
    );

    // === PHASE 3: Send create tx and wait for confirmation ===
    console.log('Phase 3: Sending create tx via RPC...');

    const createSig = await connection.sendTransaction(createTx, {
      skipPreflight: true,
      maxRetries: 3,
    });
    console.log(`Create tx sent: ${createSig}`);
    log('create_sent', { signature: createSig, detail: { mint: mintPubkey.toBase58(), backers: sortedBackers.length } });

    // Wait for create to be confirmed (bonding curve must exist for buys).
    // confirmTransaction alone is unreliable here: a blockhash/lastValidBlockHeight
    // mismatch can make it resolve on expiry rather than real confirmation, and
    // even a confirmed create can lag the bonding-curve account being readable.
    // The actual precondition for buys is that bondingCurvePda exists on chain —
    // poll for that directly with a bounded retry so buys never fire early.
    try {
      await connection.confirmTransaction(
        { signature: createSig, blockhash, lastValidBlockHeight },
        'confirmed'
      );
    } catch (e) {
      console.warn('confirmTransaction(create) did not cleanly confirm, will poll curve:', e);
    }

    let curveReady = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const acct = await connection.getAccountInfo(bondingCurvePda);
      if (acct) { curveReady = true; break; }
      await new Promise((r) => setTimeout(r, 1000)); // 1s between polls, ~15s max
    }
    if (!curveReady) {
      log('curve_timeout', {
        ok: false,
        signature: createSig,
        detail: { bondingCurvePda: bondingCurvePda.toBase58(), mint: mintPubkey.toBase58() },
      });
      throw new Error(
        `Bonding curve account ${bondingCurvePda.toBase58()} not found ~15s after create ` +
        `(createSig=${createSig}). Aborting before buys so backer funds stay in burners.`
      );
    }
    console.log(`Create confirmed + curve readable! Mint: ${mintPubkey.toBase58()}`);
    log('curve_ready', { signature: createSig, detail: { mint: mintPubkey.toBase58() } });

    // === PHASE 4: Read ACTUAL curve state, build + blast batch 1 ===
    const buyResults: BurnerBuyResult[] = [];

    // Helper: read bonding curve from chain and build buy txs for a batch
    async function buildBatchBuyTxs(
      batchBackers: BurnerBackerInfo[],
      batchKeypairs: Keypair[],
      batchATAs: PublicKey[],
      batchBalances: number[],
      batchBlockhash: string,
    ): Promise<{ txs: VersionedTransaction[]; infos: { backer: BurnerBackerInfo; buyAmount: bigint }[] }> {
      // Read actual bonding curve state from chain (~200ms)
      const bondingCurveAccount = await connection.getAccountInfo(bondingCurvePda);
      if (!bondingCurveAccount) throw new Error('Bonding curve not found after create');
      const curveData = parseBondingCurve(bondingCurveAccount.data);
      console.log(`  Curve state: vTokens=${curveData.virtualTokenReserves}, vSol=${curveData.virtualSolReserves}`);

      if (curveData.complete) throw new Error('Bonding curve already complete — token graduated');

      const txs: VersionedTransaction[] = [];
      const infos: { backer: BurnerBackerInfo; buyAmount: bigint }[] = [];

      for (let i = 0; i < batchBackers.length; i++) {
        const buyAmount = calculateBundledBuyAmount(batchBalances[i]);
        if (buyAmount <= BigInt(0)) {
          console.warn(`  Skipping ${batchBackers[i].burnerWallet.slice(0, 8)}: insufficient balance`);
          continue;
        }

        // Calculate expected tokens from ACTUAL curve state, then apply 2% safety margin
        // pump.fun buy instruction: `amount` = minimum tokens to receive, fails if cost > maxSolCost
        // The 2% discount means if curve moves up to ~25% between our read and tx landing,
        // the cost of (fewer) tokens still fits within our generous maxSolCost
        const rawExpectedTokens = calculateBuyTokenAmount(curveData, buyAmount);
        const expectedTokens = rawExpectedTokens * BigInt(98) / BigInt(100);

        // maxSolCost = full wallet balance minus only ATA rent + fees
        // This is ~5% more than buyAmount (since buyAmount = afterFixedCosts / 1.05)
        // Provides headroom for small sniper buys between curve read and tx landing
        const ataRent = BigInt(2_039_280);
        const walletRent = BigInt(890_880);
        const reserveForTransfer = BigInt(2_550_000);
        const txFees = BigInt(10_000);
        const maxSolCost = BigInt(batchBalances[i]) - ataRent - walletRent - reserveForTransfer - txFees;

        console.log(`  Backer ${i + 1}: ${Number(buyAmount) / LAMPORTS_PER_SOL} SOL -> ~${rawExpectedTokens} tokens (asking ${expectedTokens}, maxCost: ${Number(maxSolCost) / LAMPORTS_PER_SOL} SOL)`);

        // Build transaction from actual state
        const tx = new Transaction();
        tx.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 200000 })
        );
        tx.add(
          createAssociatedTokenAccountInstruction(
            batchKeypairs[i].publicKey,
            batchATAs[i],
            batchKeypairs[i].publicKey,
            mintPubkey
          )
        );
        tx.add(
          buildBuyInstruction(
            batchKeypairs[i].publicKey,
            mintPubkey,
            bondingCurvePda,
            associatedBondingCurve,
            batchATAs[i],
            curveData.creator,
            expectedTokens,
            maxSolCost
          )
        );

        const messageV0 = new TransactionMessage({
          payerKey: batchKeypairs[i].publicKey,
          recentBlockhash: batchBlockhash,
          instructions: tx.instructions,
        }).compileToV0Message();

        const versionedTx = new VersionedTransaction(messageV0);
        versionedTx.sign([batchKeypairs[i]]);

        txs.push(versionedTx);
        infos.push({ backer: batchBackers[i], buyAmount });
      }

      return { txs, infos };
    }

    // Helper: send batch and collect results
    async function sendAndCollectBatch(
      batchLabel: string,
      txs: VersionedTransaction[],
      infos: { backer: BurnerBackerInfo; buyAmount: bigint }[],
    ) {
      if (txs.length === 0) return;

      console.log(`Sending ${batchLabel} (${txs.length} buys)...`);
      const sigs = await Promise.all(
        txs.map(tx => connection.sendTransaction(tx, { skipPreflight: true, maxRetries: 3 }))
      );
      infos.forEach((info, i) =>
        log('buy_sent', { backerWallet: info.backer.mainWallet, signature: sigs[i], detail: { batch: batchLabel } })
      );

      // Wait for all to confirm
      const { blockhash: confirmBh, lastValidBlockHeight: lvbh } = await connection.getLatestBlockhash();
      const confirmations = await Promise.allSettled(
        sigs.map(sig =>
          connection.confirmTransaction({
            signature: sig,
            blockhash: confirmBh,
            lastValidBlockHeight: lvbh,
          }, 'confirmed')
        )
      );

      // Collect results - read actual token balances
      for (let i = 0; i < infos.length; i++) {
        const { backer } = infos[i];
        const confirmed = confirmations[i]?.status === 'fulfilled';
        let tokensReceived = 0;

        if (confirmed) {
          try {
            const ataIdx = sortedBackers.findIndex(b => b.mainWallet === backer.mainWallet);
            const accountInfo = await getAccount(connection, burnerATAs[ataIdx]);
            tokensReceived = Number(accountInfo.amount);
          } catch { /* token account may not exist if tx failed silently */ }
        }

        console.log(`  ${batchLabel} ${i + 1}: ${confirmed ? `${tokensReceived} tokens` : 'FAILED'}`);
        log(confirmed ? 'buy_confirmed' : 'buy_failed', {
          backerWallet: backer.mainWallet,
          ok: confirmed,
          signature: sigs[i],
          detail: { batch: batchLabel, tokensReceived, burnerWallet: backer.burnerWallet },
        });
        buyResults.push({
          mainWallet: backer.mainWallet,
          burnerWallet: backer.burnerWallet,
          amountSol: backer.amountSol,
          tokensReceived,
          buySignature: confirmed ? sigs[i] : undefined,
          error: confirmed ? undefined : 'Transaction failed to confirm',
        });
      }

      const batchSuccesses = infos.filter((_, i) => confirmations[i]?.status === 'fulfilled').length;
      console.log(`${batchLabel}: ${batchSuccesses}/${infos.length} confirmed`);
    }

    // Batch 1: Genesis — read actual curve, build, blast
    if (batch1.length > 0) {
      const { blockhash: b1Blockhash } = await connection.getLatestBlockhash('confirmed');
      const { txs: batch1Txs, infos: batch1Infos } = await buildBatchBuyTxs(
        batch1,
        burnerKeypairs.slice(0, BATCH_SIZE),
        burnerATAs.slice(0, BATCH_SIZE),
        balances.slice(0, BATCH_SIZE) as number[],
        b1Blockhash,
      );
      await sendAndCollectBatch('Genesis', batch1Txs, batch1Infos);
    }

    // Batch 2: Wave 2 — read curve AGAIN (reflects batch 1 + any snipers), build, blast
    if (batch2.length > 0) {
      const { blockhash: b2Blockhash } = await connection.getLatestBlockhash('confirmed');
      const { txs: batch2Txs, infos: batch2Infos } = await buildBatchBuyTxs(
        batch2,
        burnerKeypairs.slice(BATCH_SIZE),
        burnerATAs.slice(BATCH_SIZE),
        balances.slice(BATCH_SIZE) as number[],
        b2Blockhash,
      );
      await sendAndCollectBatch('Wave 2', batch2Txs, batch2Infos);
    }

    // === PHASE 5: Retry any failed buys via standard executeBurnerBuy ===
    const failedBuys = buyResults.filter(r => !r.buySignature);
    if (failedBuys.length > 0) {
      console.log(`Retrying ${failedBuys.length} failed buys via standard flow...`);
      for (const failed of failedBuys) {
        const backer = sortedBackers.find(b => b.mainWallet === failed.mainWallet);
        if (!backer) continue;

        log('retry_attempt', { backerWallet: failed.mainWallet, detail: { burnerWallet: failed.burnerWallet } });
        const burnerKeypair = decryptBurnerKey(backer.encryptedPrivateKey);
        const retryResult = await executeBurnerBuy(sdk, connection, burnerKeypair, mintPubkey, backer.amountSol);
        log('retry_result', {
          backerWallet: failed.mainWallet,
          ok: !!retryResult.signature,
          signature: retryResult.signature,
          detail: { tokensReceived: retryResult.tokensReceived, error: retryResult.error },
        });

        // Update the result in place
        const idx = buyResults.findIndex(r => r.mainWallet === failed.mainWallet);
        if (idx !== -1 && retryResult.signature) {
          buyResults[idx] = {
            ...buyResults[idx],
            tokensReceived: retryResult.tokensReceived,
            buySignature: retryResult.signature,
            error: undefined,
          };
          console.log(`  Retry successful for ${failed.burnerWallet.slice(0, 8)}: ${retryResult.tokensReceived} tokens`);
        } else if (idx !== -1) {
          buyResults[idx].error = retryResult.error || 'Retry also failed';
          console.log(`  Retry failed for ${failed.burnerWallet.slice(0, 8)}: ${retryResult.error}`);
        }
      }
    }

    const successfulBuys = buyResults.filter(r => r.buySignature);
    console.log(`=== LAUNCH COMPLETE: ${successfulBuys.length}/${sortedBackers.length} buys successful ===`);
    log('launch_complete', {
      ok: successfulBuys.length === sortedBackers.length,
      signature: createSig,
      detail: {
        mint: mintKeypair.publicKey.toBase58(),
        successfulBuys: successfulBuys.length,
        totalBackers: sortedBackers.length,
        failed: buyResults.filter(r => !r.buySignature).map(r => r.mainWallet),
      },
    });

    return {
      success: successfulBuys.length > 0,
      mintAddress: mintKeypair.publicKey.toBase58(),
      pumpFunUrl: `https://pump.fun/coin/${mintKeypair.publicKey.toBase58()}`,
      createSignature: createSig,
      buyResults,
    };
  } catch (error) {
    console.error('Batched RPC launch failed:', error);
    log('launch_error', {
      ok: false,
      detail: { error: error instanceof Error ? error.message : 'Unknown error' },
    });
    return {
      success: false,
      buyResults: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// PRIMARY LAUNCH PATH. Atomic Jito bundle = create tx (tip embedded) +
// the 4 Genesis buys in ONE block, eliminating the sniper/create->buy
// gap entirely for slots 1-4. Slots 5-8 buy via RPC immediately after.
// Layered fallback to standard RPC if the bundle does not land, with the
// reconcile/auto-refund net underneath as the final backstop.
export async function launchWithJitoBundle(
  config: LaunchConfig,
  burnerBackers: BurnerBackerInfo[],
  log: LaunchLogger = noopLaunchLogger
): Promise<{
  success: boolean;
  mintAddress?: string;
  pumpFunUrl?: string;
  createSignature?: string;
  buyResults: BurnerBuyResult[];
  bundleUsed?: boolean;
  bundleId?: string;
  error?: string;
}> {
  const JITO_TIP_LAMPORTS = 7_000_000; // 0.007 SOL tip (embedded in create tx)
  // With tip embedded in create tx: 1 create (with tip) + 4 buys = 5 max
  const MAX_BUNDLED_BUYS = 4; // Genesis tier - same-block buys

  try {
    console.log(`=== JITO BUNDLE LAUNCH START ===`);
    console.log(`Token: ${config.name} (${config.symbol})`);
    console.log(`Backers: ${burnerBackers.length}`);
    console.log(`Total backing: ${config.totalBackingSol} SOL`);

    // Sort backers by backing time (earliest first = best price)
    const sortedBackers = [...burnerBackers].sort(
      (a, b) => new Date(a.backedAt).getTime() - new Date(b.backedAt).getTime()
    );

    // Split into Genesis (first 4, bundled) and Wave 2 (rest, overflow)
    const genesisBackers = sortedBackers.slice(0, MAX_BUNDLED_BUYS);
    const waveTwoBackers = sortedBackers.slice(MAX_BUNDLED_BUYS);
    console.log(`Genesis (bundled): ${genesisBackers.length} | Wave 2 (overflow): ${waveTwoBackers.length}`);

    // 1. Upload metadata to IPFS
    console.log('Step 1: Uploading metadata to IPFS...');
    const { metadataUri } = await uploadMetadata(config);
    console.log(`Metadata uploaded: ${metadataUri}`);

    // 2. Prepare keys and SDK
    const escrowKeypair = getEscrowWallet();
    const mintKeypair = Keypair.generate();
    const sdk = await createPumpFunSDK();
    const connection = new Connection(RPC_URL, 'confirmed');

    // 3. Fetch initial bonding curve constants from chain
    console.log('Step 2: Fetching bonding curve constants...');
    const initialCurveState = await fetchInitialCurveConstants(sdk);
    console.log(`Initial curve: vTokens=${initialCurveState.virtualTokenReserves}, vSol=${initialCurveState.virtualSolReserves}`);

    // 4. Fetch all Genesis burner wallet balances in parallel
    console.log('Step 3: Checking Genesis wallet balances...');
    const balances = await Promise.all(
      genesisBackers.map(b => connection.getBalance(new PublicKey(b.burnerWallet)))
    );

    // 5. Get a fresh blockhash (shared by all txs in bundle)
    const { blockhash } = await connection.getLatestBlockhash('confirmed');

    // 6. Build all transactions for the genesis bundle
    console.log('Step 4: Building genesis bundle (tip embedded in create tx)...');
    const transactions: VersionedTransaction[] = [];

    // Transaction 1: Token creation WITH Jito tip embedded (saves a tx slot)
    const createTx = await buildCreationVersionedTx(
      sdk, escrowKeypair, mintKeypair, metadataUri, config, blockhash,
      JITO_TIP_LAMPORTS // Embed tip here instead of separate tx
    );
    transactions.push(createTx);

    // Transactions 2-5: Genesis backer buys (simulate curve sequentially)
    let curveState = { ...initialCurveState };
    const bundledBuyInfo: { backer: BurnerBackerInfo; predictedTokens: bigint; buyAmount: bigint }[] = [];

    for (let i = 0; i < genesisBackers.length; i++) {
      const backer = genesisBackers[i];
      const buyAmount = calculateBundledBuyAmount(balances[i]);

      if (buyAmount <= BigInt(0)) {
        console.warn(`Skipping bundled buy for ${backer.burnerWallet.slice(0, 8)}: insufficient balance (${balances[i]} lamports)`);
        continue;
      }

      // Simulate buy on predicted curve to get expected tokens
      const { tokensOut, newState } = simulateBuy(curveState, buyAmount);
      curveState = newState;

      console.log(`  Backer ${i + 1}: ${Number(buyAmount) / LAMPORTS_PER_SOL} SOL -> ~${tokensOut} tokens (predicted)`);

      const burnerKeypair = decryptBurnerKey(backer.encryptedPrivateKey);
      const buyTx = await buildBundledBuyVersionedTx(
        burnerKeypair,
        mintKeypair.publicKey,
        escrowKeypair.publicKey,
        buyAmount,
        tokensOut,
        blockhash
      );
      transactions.push(buyTx);
      bundledBuyInfo.push({ backer, predictedTokens: tokensOut, buyAmount });
    }

    // Note: Jito tip is now embedded in create tx, no separate tip transaction needed
    console.log(`Bundle has ${transactions.length} transactions (1 create + ${bundledBuyInfo.length} buys, max 5)`);
    if (transactions.length > 5) {
      throw new Error(`Bundle exceeds 5 transaction limit: ${transactions.length}`);
    }

    // 7. Submit bundle to Jito
    console.log('Step 5: Submitting Jito bundle...');
    const bundleId = await submitJitoBundle(transactions);
    log('create_sent', {
      signature: bundleId,
      detail: { mode: 'jito-bundle', mint: mintKeypair.publicKey.toBase58(), genesis: bundledBuyInfo.length, wave2: waveTwoBackers.length },
    });

    // 8. Wait for confirmation
    console.log('Step 6: Waiting for bundle confirmation...');
    const confirmation = await confirmJitoBundle(bundleId);

    if (!confirmation.landed) {
      console.warn('Jito bundle did not land, checking if token was created...');
      log('curve_timeout', { ok: false, signature: bundleId, detail: { reason: 'jito bundle did not land' } });

      // Check if token was created anyway (bundle timeout doesn't mean failure)
      const mintInfo = await connection.getAccountInfo(mintKeypair.publicKey);
      if (mintInfo) {
        console.log('Token was created despite bundle timeout - executing all buys via standard flow');
        log('retry_attempt', { detail: { reason: 'bundle missed but token exists, all buys via RPC', mint: mintKeypair.publicKey.toBase58() } });
        const allBuyResults = await executeAllBuysStandard(sdk, connection, mintKeypair.publicKey, sortedBackers);
        allBuyResults.forEach(r =>
          log(r.buySignature ? 'buy_confirmed' : 'buy_failed', {
            backerWallet: r.mainWallet, ok: !!r.buySignature, signature: r.buySignature,
            detail: { via: 'rpc-fallback', tokensReceived: r.tokensReceived, error: r.error },
          })
        );
        return {
          success: allBuyResults.some(r => r.buySignature),
          mintAddress: mintKeypair.publicKey.toBase58(),
          pumpFunUrl: `https://pump.fun/coin/${mintKeypair.publicKey.toBase58()}`,
          buyResults: allBuyResults,
          bundleUsed: false,
          bundleId,
        };
      }

      // Full fallback to standard launch
      console.log('Falling back to standard launchWithBurnerWallets...');
      log('retry_attempt', { detail: { reason: 'bundle missed, no token, full standard launch' } });
      const fallbackResult = await launchWithBurnerWallets(config, burnerBackers);
      log(fallbackResult.success ? 'launch_complete' : 'launch_error', {
        ok: fallbackResult.success,
        detail: { via: 'standard-fallback', mint: fallbackResult.mintAddress },
      });
      return { ...fallbackResult, bundleUsed: false, bundleId };
    }

    console.log(`Genesis bundle landed! ${bundledBuyInfo.length} Genesis buys included.`);
    log('curve_ready', { signature: bundleId, detail: { mode: 'jito-bundle-landed', mint: mintKeypair.publicKey.toBase58(), genesisBuys: bundledBuyInfo.length } });

    // 9. Build results for bundled buys - verify actual token balances
    const buyResults: BurnerBuyResult[] = [];

    for (let idx = 0; idx < bundledBuyInfo.length; idx++) {
      const { backer, predictedTokens } = bundledBuyInfo[idx];
      let tokensReceived = Number(predictedTokens);
      let buySignature: string | undefined;

      // Try to get actual token balance from chain
      try {
        const ata = await getAssociatedTokenAddress(mintKeypair.publicKey, new PublicKey(backer.burnerWallet));
        const accountInfo = await getAccount(connection, ata);
        tokensReceived = Number(accountInfo.amount);
      } catch {
        // Use predicted amount if account not readable yet
      }

      // Get buy signature from bundle confirmation (order: create+tip, buy1, buy2, buy3, buy4)
      if (confirmation.signatures && confirmation.signatures.length > idx + 1) {
        buySignature = confirmation.signatures[idx + 1]; // +1 to skip create tx
      }

      buyResults.push({
        mainWallet: backer.mainWallet,
        burnerWallet: backer.burnerWallet,
        amountSol: backer.amountSol,
        tokensReceived,
        buySignature,
      });
      log(buySignature || tokensReceived > 0 ? 'buy_confirmed' : 'buy_failed', {
        backerWallet: backer.mainWallet,
        ok: !!(buySignature || tokensReceived > 0),
        signature: buySignature,
        detail: { tier: 'genesis', via: 'jito-bundle', tokensReceived },
      });
    }

    // 10. Execute Wave 2 buys (backers 5+) via fast overflow flow
    if (waveTwoBackers.length > 0) {
      console.log(`Step 7: Executing ${waveTwoBackers.length} Wave 2 buys...`);
      const waveTwoResults = await executeAllBuysStandard(sdk, connection, mintKeypair.publicKey, waveTwoBackers);
      waveTwoResults.forEach(r =>
        log(r.buySignature ? 'buy_confirmed' : 'buy_failed', {
          backerWallet: r.mainWallet, ok: !!r.buySignature, signature: r.buySignature,
          detail: { tier: 'wave2', via: 'rpc', tokensReceived: r.tokensReceived, error: r.error },
        })
      );
      buyResults.push(...waveTwoResults);
    }

    const successfulBuys = buyResults.filter(r => r.buySignature || r.tokensReceived > 0);
    console.log(`=== JITO LAUNCH COMPLETE ===`);
    console.log(`${successfulBuys.length}/${sortedBackers.length} buys successful`);
    console.log(`Bundle ID: ${bundleId}`);
    log('launch_complete', {
      ok: successfulBuys.length === sortedBackers.length,
      signature: bundleId,
      detail: {
        mode: 'jito-bundle',
        mint: mintKeypair.publicKey.toBase58(),
        successfulBuys: successfulBuys.length,
        totalBackers: sortedBackers.length,
        failed: buyResults.filter(r => !(r.buySignature || r.tokensReceived > 0)).map(r => r.mainWallet),
      },
    });

    return {
      success: true,
      mintAddress: mintKeypair.publicKey.toBase58(),
      pumpFunUrl: `https://pump.fun/coin/${mintKeypair.publicKey.toBase58()}`,
      buyResults,
      bundleUsed: true,
      bundleId,
    };
  } catch (error) {
    console.error('Jito bundle launch failed:', error);
    log('retry_attempt', { ok: false, detail: { reason: 'jito path threw, entering fast RPC fallback', error: error instanceof Error ? error.message : String(error) } });

    // Fast fallback: reuse mint keypair + metadata, send create via RPC, then blast buys
    // This avoids re-uploading to IPFS and minimizes the snipe window
    console.log('Fast fallback: sending create tx via RPC then immediate buys...');
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const escrowKeypair = getEscrowWallet();

      // Reuse the mint keypair and metadata URI from the failed Jito attempt
      // These are captured in the closure from the try block above
      // We need to re-prepare them since they're scoped inside the try block
      const fallbackMintKeypair = Keypair.generate();
      const fallbackSdk = await createPumpFunSDK();

      // Upload metadata (or reuse if we had a way to pass it - for now re-upload is fast since IPFS caches)
      console.log('Uploading metadata...');
      const { metadataUri: fallbackUri } = await uploadMetadata(config);

      // Build and send create tx with high priority fees (no Jito tip)
      const { blockhash } = await connection.getLatestBlockhash('confirmed');
      const createTx = await buildCreationVersionedTx(
        fallbackSdk, escrowKeypair, fallbackMintKeypair, fallbackUri, config, blockhash, 0
      );

      console.log('Sending create tx via RPC...');
      const createSig = await connection.sendTransaction(createTx, {
        skipPreflight: true,
        maxRetries: 3,
      });
      console.log(`Create tx sent: ${createSig}`);

      // Wait for create tx to be processed (not finalized - just enough for buys to work)
      console.log('Waiting for create tx to be processed...');
      await connection.confirmTransaction(createSig, 'confirmed');
      console.log(`Create tx confirmed! Mint: ${fallbackMintKeypair.publicKey.toBase58()}`);

      // Immediately fire ALL buys in parallel (no staggering - speed is priority)
      const sortedBackers = [...burnerBackers].sort(
        (a, b) => new Date(a.backedAt).getTime() - new Date(b.backedAt).getTime()
      );

      console.log(`Blasting ${sortedBackers.length} buy transactions simultaneously...`);
      const mintPubkey = fallbackMintKeypair.publicKey;

      const buyPromises = sortedBackers.map(async (backer, i) => {
        try {
          const burnerKeypair = decryptBurnerKey(backer.encryptedPrivateKey);
          if (burnerKeypair.publicKey.toBase58() !== backer.burnerWallet) {
            return { mainWallet: backer.mainWallet, burnerWallet: backer.burnerWallet, amountSol: backer.amountSol, tokensReceived: 0, error: 'Key mismatch' };
          }
          const result = await executeBurnerBuy(fallbackSdk, connection, burnerKeypair, mintPubkey, backer.amountSol);
          if (result.signature) {
            console.log(`  [${i + 1}] Buy successful: ${result.tokensReceived} tokens`);
          } else {
            console.log(`  [${i + 1}] Buy failed: ${result.error}`);
          }
          return {
            mainWallet: backer.mainWallet,
            burnerWallet: backer.burnerWallet,
            amountSol: backer.amountSol,
            tokensReceived: result.tokensReceived,
            buySignature: result.signature,
            error: result.error,
          };
        } catch (err) {
          return {
            mainWallet: backer.mainWallet,
            burnerWallet: backer.burnerWallet,
            amountSol: backer.amountSol,
            tokensReceived: 0,
            error: err instanceof Error ? err.message : 'Unknown error',
          };
        }
      });

      const buyResults = await Promise.all(buyPromises);
      const successfulBuys = buyResults.filter(r => r.buySignature);
      console.log(`=== FAST FALLBACK COMPLETE ===`);
      console.log(`${successfulBuys.length}/${sortedBackers.length} buys successful`);
      buyResults.forEach(r =>
        log(r.buySignature ? 'buy_confirmed' : 'buy_failed', {
          backerWallet: r.mainWallet, ok: !!r.buySignature, signature: r.buySignature,
          detail: { via: 'fast-fallback', tokensReceived: r.tokensReceived, error: r.error },
        })
      );
      log(successfulBuys.length > 0 ? 'launch_complete' : 'launch_error', {
        ok: successfulBuys.length === sortedBackers.length,
        signature: createSig,
        detail: { mode: 'fast-fallback', mint: fallbackMintKeypair.publicKey.toBase58(), successfulBuys: successfulBuys.length, totalBackers: sortedBackers.length },
      });

      return {
        success: successfulBuys.length > 0,
        mintAddress: fallbackMintKeypair.publicKey.toBase58(),
        pumpFunUrl: `https://pump.fun/coin/${fallbackMintKeypair.publicKey.toBase58()}`,
        createSignature: createSig,
        buyResults,
        bundleUsed: false,
      };
    } catch (fallbackError) {
      console.error('Fast fallback also failed:', fallbackError);
      log('launch_error', {
        ok: false,
        detail: {
          stage: 'fast-fallback',
          error: error instanceof Error ? error.message : 'Unknown error',
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        },
      });
      return {
        success: false,
        buyResults: [],
        bundleUsed: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Sweep result
export interface SweepResult {
  success: boolean;
  signature?: string;
  amount?: number; // SOL for sell, tokens for transfer
  error?: string;
}

// Sweep tokens from burner wallet - either sell or transfer to main wallet
export async function sweepBurnerWallet(
  mintAddress: string,
  encryptedPrivateKey: string,
  burnerWalletAddress: string,
  mainWalletAddress: string,
  action: 'sell' | 'transfer'
): Promise<SweepResult> {
  try {
    console.log(`=== SWEEP ${action.toUpperCase()} START ===`);
    console.log(`Burner: ${burnerWalletAddress}`);
    console.log(`Main wallet: ${mainWalletAddress}`);
    console.log(`Token: ${mintAddress}`);

    // Decrypt burner wallet
    const burnerKeypair = decryptBurnerKey(encryptedPrivateKey);

    // Verify the key matches
    if (burnerKeypair.publicKey.toBase58() !== burnerWalletAddress) {
      return { success: false, error: 'Burner key mismatch' };
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const mintPubkey = new PublicKey(mintAddress);
    const mainWalletPubkey = new PublicKey(mainWalletAddress);

    // Get burner's token account
    const burnerTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      burnerKeypair.publicKey
    );

    // Get token balance
    let tokenBalance: bigint;
    try {
      const accountInfo = await getAccount(connection, burnerTokenAccount);
      tokenBalance = accountInfo.amount;
    } catch {
      return { success: false, error: 'No tokens in burner wallet' };
    }

    if (tokenBalance === BigInt(0)) {
      return { success: false, error: 'Token balance is 0' };
    }

    console.log(`Token balance: ${tokenBalance}`);

    if (action === 'sell') {
      // Sell tokens on pump.fun, receive SOL
      const sdk = await createPumpFunSDK();

      const sellResult = await sdk.sell(
        burnerKeypair,
        mintPubkey,
        tokenBalance,
        BigInt(1000), // 10% slippage
        {
          unitLimit: 400000,
          unitPrice: 500000,
        }
      );

      if (!sellResult.success) {
        return { success: false, error: sellResult.error?.toString() || 'Sell failed' };
      }

      // Get SOL received and transfer to main wallet
      // Leave a small amount for rent
      const burnerBalance = await connection.getBalance(burnerKeypair.publicKey);
      const rentExempt = 5000; // ~0.000005 SOL for rent
      const solToSend = burnerBalance - rentExempt - 5000; // Extra for tx fee

      if (solToSend > 0) {
        const transferTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: burnerKeypair.publicKey,
            toPubkey: mainWalletPubkey,
            lamports: solToSend,
          })
        );

        const { blockhash } = await connection.getLatestBlockhash();
        transferTx.recentBlockhash = blockhash;
        transferTx.feePayer = burnerKeypair.publicKey;

        const transferSig = await connection.sendTransaction(transferTx, [burnerKeypair]);
        console.log(`SOL transferred to main wallet: ${transferSig}`);
      }

      console.log(`Sold tokens, signature: ${sellResult.signature}`);
      return {
        success: true,
        signature: sellResult.signature,
        amount: solToSend / LAMPORTS_PER_SOL,
      };
    } else {
      // Transfer tokens to main wallet
      const mainTokenAccount = await getAssociatedTokenAddress(
        mintPubkey,
        mainWalletPubkey
      );

      const transaction = new Transaction();

      // Check if main wallet's token account exists
      const mainAccountInfo = await connection.getAccountInfo(mainTokenAccount);
      const needsATA = !mainAccountInfo;

      // Check burner balance - need ~0.002 SOL for ATA creation + fees
      const burnerBalance = await connection.getBalance(burnerKeypair.publicKey);
      const minRequiredForATA = 2500000; // ~0.0025 SOL for ATA rent + fees
      const minRequiredForTransfer = 10000; // ~0.00001 SOL for just transfer fee

      const minRequired = needsATA ? minRequiredForATA : minRequiredForTransfer;

      if (burnerBalance < minRequired) {
        if (needsATA) {
          return {
            success: false,
            error: `Burner wallet needs ~0.0025 SOL to create token account. Current balance: ${(burnerBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL. Please use Export Private Key to manage tokens manually.`,
          };
        } else {
          return {
            success: false,
            error: `Burner wallet needs SOL for transaction fees. Current balance: ${(burnerBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
          };
        }
      }

      if (needsATA) {
        // Create token account for main wallet (burner pays)
        transaction.add(
          createAssociatedTokenAccountInstruction(
            burnerKeypair.publicKey,
            mainTokenAccount,
            mainWalletPubkey,
            mintPubkey
          )
        );
      }

      // Transfer all tokens
      transaction.add(
        createTransferInstruction(
          burnerTokenAccount,
          mainTokenAccount,
          burnerKeypair.publicKey,
          tokenBalance
        )
      );

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = burnerKeypair.publicKey;

      const signature = await connection.sendTransaction(transaction, [burnerKeypair]);
      console.log(`Tokens transferred to main wallet: ${signature}`);

      return {
        success: true,
        signature,
        amount: Number(tokenBalance),
      };
    }
  } catch (error) {
    console.error('Sweep failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Refund result
export interface RefundResult {
  success: boolean;
  signature?: string;
  amountRefunded?: number;
  error?: string;
}

// Refund SOL from burner wallet back to user's main wallet (pre-launch withdrawal)
export async function refundFromBurnerWallet(
  encryptedPrivateKey: string,
  burnerWalletAddress: string,
  mainWalletAddress: string,
  expectedAmount: number,
  feePercent: number = 2
): Promise<RefundResult> {
  try {
    console.log(`=== BURNER WALLET REFUND START ===`);
    console.log(`Burner: ${burnerWalletAddress}`);
    console.log(`Main wallet: ${mainWalletAddress}`);
    console.log(`Expected amount: ${expectedAmount} SOL`);
    console.log(`Fee: ${feePercent}%`);

    // Decrypt burner wallet
    const burnerKeypair = decryptBurnerKey(encryptedPrivateKey);

    // Verify the key matches
    if (burnerKeypair.publicKey.toBase58() !== burnerWalletAddress) {
      return { success: false, error: 'Burner key mismatch' };
    }

    const connection = new Connection(RPC_URL, 'confirmed');
    const mainWalletPubkey = new PublicKey(mainWalletAddress);

    // Get burner's SOL balance
    const burnerBalance = await connection.getBalance(burnerKeypair.publicKey);
    console.log(`Burner SOL balance: ${burnerBalance / LAMPORTS_PER_SOL} SOL`);

    if (burnerBalance === 0) {
      return { success: false, error: 'Burner wallet has no SOL' };
    }

    // Drain the burner to EXACTLY 0 lamports.
    //
    // A burner is a plain system account. Solana rejects any transaction
    // that leaves a non-rent-exempt account with a non-zero balance, so
    // leaving even a few hundred lamports of dust makes the refund fail
    // with "insufficient funds for rent" (the exact failure the
    // reconcile job hit on the $TEST burners). The only safe terminal
    // state is exactly 0 — that closes the account cleanly.
    //
    // This tx has one signer (the burner) and only SystemProgram
    // transfers, no compute-budget instructions, so the network fee is
    // the flat base fee of 5000 lamports.
    const BASE_FEE = 5000;
    const rawFee = Math.floor(burnerBalance * (feePercent / 100));
    // Only route a fee to escrow if it clears dust; otherwise it folds
    // back into the user's refund so the account can still hit zero.
    const escrowFee = rawFee > BASE_FEE ? rawFee : 0;
    const amountToSend = burnerBalance - BASE_FEE - escrowFee;

    if (amountToSend <= 0) {
      return { success: false, error: 'Insufficient balance after fees' };
    }

    console.log(`Refunding ${amountToSend / LAMPORTS_PER_SOL} SOL (escrow fee: ${escrowFee / LAMPORTS_PER_SOL} SOL), draining burner to 0`);

    // Get escrow wallet for fee collection
    const escrowWallet = getEscrowWallet();

    // Create transfer transaction - refund to user AND fee to escrow
    const transaction = new Transaction();

    // Transfer refund to user
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: burnerKeypair.publicKey,
        toPubkey: mainWalletPubkey,
        lamports: amountToSend,
      })
    );

    // Transfer fee to escrow (only when it cleared the dust threshold).
    // amountToSend + escrowFee + BASE_FEE == burnerBalance, so the
    // burner lands at exactly 0 either way.
    if (escrowFee > 0) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: burnerKeypair.publicKey,
          toPubkey: escrowWallet.publicKey,
          lamports: escrowFee,
        })
      );
      console.log(`Sending ${escrowFee / LAMPORTS_PER_SOL} SOL fee to escrow: ${escrowWallet.publicKey.toBase58()}`);
    }

    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = burnerKeypair.publicKey;

    const signature = await connection.sendTransaction(transaction, [burnerKeypair]);
    console.log(`Refund sent: ${signature}`);

    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    console.log(`=== REFUND COMPLETE ===`);
    return {
      success: true,
      signature,
      amountRefunded: amountToSend / LAMPORTS_PER_SOL,
    };
  } catch (error) {
    console.error('Refund from burner wallet failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// Distribution result for a single backer
export interface DistributionResult {
  wallet: string;
  tokensTransferred: number;
  signature?: string;
  error?: string;
}

// Distribute tokens to backers proportionally
export async function distributeTokensToBackers(
  mintAddress: string,
  backers: BackerInfo[],
  totalBackingSol: number
): Promise<{ success: boolean; results: DistributionResult[]; error?: string }> {
  const results: DistributionResult[] = [];

  try {
    const connection = new Connection(RPC_URL, 'confirmed');
    const escrowWallet = getEscrowWallet();
    const mintPubkey = new PublicKey(mintAddress);

    // Get escrow's token account
    const escrowTokenAccount = await getAssociatedTokenAddress(
      mintPubkey,
      escrowWallet.publicKey
    );

    // Get escrow token balance
    let escrowTokenBalance: bigint;
    try {
      const accountInfo = await getAccount(connection, escrowTokenAccount);
      escrowTokenBalance = accountInfo.amount;
      console.log(`Escrow token balance: ${escrowTokenBalance.toString()}`);
    } catch (err) {
      return {
        success: false,
        results: [],
        error: 'Escrow has no tokens to distribute',
      };
    }

    if (escrowTokenBalance === BigInt(0)) {
      return {
        success: false,
        results: [],
        error: 'Escrow token balance is 0',
      };
    }

    // Calculate each backer's share and distribute
    for (const backer of backers) {
      try {
        const backerPubkey = new PublicKey(backer.wallet);

        // Calculate proportional share
        const sharePercent = backer.amountSol / totalBackingSol;
        const tokensToTransfer = BigInt(
          Math.floor(Number(escrowTokenBalance) * sharePercent)
        );

        if (tokensToTransfer === BigInt(0)) {
          results.push({
            wallet: backer.wallet,
            tokensTransferred: 0,
            error: 'Share too small',
          });
          continue;
        }

        // Get or create backer's token account
        const backerTokenAccount = await getAssociatedTokenAddress(
          mintPubkey,
          backerPubkey
        );

        const transaction = new Transaction();

        // Check if backer's token account exists
        const backerAccountInfo = await connection.getAccountInfo(backerTokenAccount);
        if (!backerAccountInfo) {
          // Create associated token account for backer
          transaction.add(
            createAssociatedTokenAccountInstruction(
              escrowWallet.publicKey, // payer
              backerTokenAccount, // ata
              backerPubkey, // owner
              mintPubkey // mint
            )
          );
        }

        // Add transfer instruction
        transaction.add(
          createTransferInstruction(
            escrowTokenAccount, // from
            backerTokenAccount, // to
            escrowWallet.publicKey, // owner
            tokensToTransfer // amount
          )
        );

        // Send transaction
        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = escrowWallet.publicKey;

        const signature = await connection.sendTransaction(transaction, [escrowWallet]);
        // Don't wait for confirmation - transaction is already submitted
        // Add small delay between transfers to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

        results.push({
          wallet: backer.wallet,
          tokensTransferred: Number(tokensToTransfer),
          signature,
        });

        console.log(
          `Distributed ${tokensToTransfer} tokens to ${backer.wallet} (${(sharePercent * 100).toFixed(2)}%)`
        );
      } catch (err) {
        console.error(`Failed to distribute to ${backer.wallet}:`, err);
        results.push({
          wallet: backer.wallet,
          tokensTransferred: 0,
          error: err instanceof Error ? err.message : 'Transfer failed',
        });
      }
    }

    const successCount = results.filter((r) => r.signature).length;
    console.log(`Distribution complete: ${successCount}/${backers.length} successful`);

    return {
      success: successCount > 0,
      results,
    };
  } catch (error) {
    console.error('Distribution failed:', error);
    return {
      success: false,
      results,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
