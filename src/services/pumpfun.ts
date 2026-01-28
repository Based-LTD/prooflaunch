import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { PumpFunSDK } from 'pumpdotfun-sdk';
import { AnchorProvider } from '@coral-xyz/anchor';
import type { Wallet as WalletInterface } from '@coral-xyz/anchor/dist/cjs/provider';
import bs58 from 'bs58';
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

  // 16 accounts in exact order from IDL
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

    return verifyTransactionDetails(tx, expectedAmount);
  } catch (error) {
    console.error('Failed to verify deposit:', error);
    return false;
  }
}

// Helper to verify transaction details
function verifyTransactionDetails(tx: any, expectedAmount: number): boolean {
  const escrowWallet = getEscrowWallet();
  const escrowAddress = escrowWallet.publicKey.toBase58();
  console.log('Escrow address:', escrowAddress);

  // Check if transaction involves escrow wallet
  const accountKeys = tx.transaction.message.getAccountKeys();
  const allKeys = accountKeys.staticAccountKeys.map((k: PublicKey) => k.toBase58());
  console.log('Transaction accounts:', allKeys);

  const escrowIndex = allKeys.findIndex((key: string) => key === escrowAddress);

  if (escrowIndex === -1) {
    console.log('Escrow wallet not found in transaction');
    return false;
  }

  // Check balance change
  const preBalance = tx.meta.preBalances[escrowIndex];
  const postBalance = tx.meta.postBalances[escrowIndex];
  const depositedLamports = postBalance - preBalance;
  const depositedSol = depositedLamports / LAMPORTS_PER_SOL;

  console.log('Pre balance:', preBalance / LAMPORTS_PER_SOL, 'SOL');
  console.log('Post balance:', postBalance / LAMPORTS_PER_SOL, 'SOL');
  console.log('Deposited:', depositedSol, 'SOL');

  // Allow small variance for fees
  const isValid = Math.abs(depositedSol - expectedAmount) < 0.01; // Increased tolerance
  console.log('Verification result:', isValid);
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

// Jito bundle endpoint
const JITO_BUNDLE_URL = 'https://mainnet.block-engine.jito.wtf/api/v1/bundles';

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
    console.log('=== executeBurnerBuy V7 - divide by 1.02 for fees ===');

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

    // pump.fun charges 1% fee on buy amount, but testing shows there's more overhead
    // From testing: 7,059,840 afterFixed but only 6,085,564 actually available
    // That's about 86% of afterFixed, so divide by 1.16 to be safe
    // Using 1.20 for extra margin
    const availableForBuy = Math.floor(afterFixedCosts / 1.20);

    console.log('>>> Balance:', burnerBalance);
    console.log('>>> Fixed costs: ATA', ataRent, '+ rentExempt', walletRentExempt, '+ reserveForTransfer', reserveForTransfer, '+ fees', baseTxFee + priorityFee, '=', ataRent + walletRentExempt + reserveForTransfer + baseTxFee + priorityFee);
    console.log('>>> After fixed:', afterFixedCosts, '| Available (÷1.20):', availableForBuy, '=', availableForBuy / 1e9, 'SOL');

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

    // Apply 20% slippage tolerance for max SOL cost
    const maxSolCost = (buyAmountLamports * BigInt(120)) / BigInt(100);
    console.log('>>> Max SOL cost (with 20% slippage):', Number(maxSolCost) / LAMPORTS_PER_SOL, 'SOL');

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

// Decrypt a burner wallet private key (server-side encrypted)
// The key is stored as "enc:<base64-encoded-private-key>"
function decryptBurnerKey(encryptedKey: string): Keypair {
  // Check for our encryption prefix
  if (encryptedKey.startsWith('enc:')) {
    const base64Key = encryptedKey.slice(4);
    const privateKeyStr = Buffer.from(base64Key, 'base64').toString('utf-8');
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

    // Calculate refund amount (minus fee and tx costs)
    const feeAmount = Math.floor(burnerBalance * (feePercent / 100));
    const txFee = 10000; // ~0.00001 SOL for transaction fees (2 transfers)
    const amountToSend = burnerBalance - feeAmount - txFee;

    if (amountToSend <= 0) {
      return { success: false, error: 'Insufficient balance after fees' };
    }

    console.log(`Refunding ${amountToSend / LAMPORTS_PER_SOL} SOL (fee: ${feeAmount / LAMPORTS_PER_SOL} SOL to escrow)`);

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

    // Transfer fee to escrow (only if there's a meaningful fee amount)
    if (feeAmount > 5000) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: burnerKeypair.publicKey,
          toPubkey: escrowWallet.publicKey,
          lamports: feeAmount,
        })
      );
      console.log(`Sending ${feeAmount / LAMPORTS_PER_SOL} SOL fee to escrow: ${escrowWallet.publicKey.toBase58()}`);
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
