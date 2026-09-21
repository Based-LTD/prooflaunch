import type { Metadata } from 'next';
import { isAddress } from 'viem';
import { rhcPublicClient, campaignAbi } from '@/lib/rhc';

// Per-campaign link cards. The page itself is a client component, so the
// metadata lives here: one on-chain read of the token meta, and the shared
// link says "$PROOF — ProofLaunch on Robinhood Chain" with the campaign's
// own description instead of the generic site card. Falls back to the RHC
// card if the read fails or the address is bad.
export async function generateMetadata({ params }: { params: Promise<{ address: string }> }): Promise<Metadata> {
  const { address } = await params;
  const base = 'https://prooflaunch.fun';
  const image = { url: `${base}/opengraph-image`, width: 1200, height: 630, alt: 'ProofLaunch on Robinhood Chain' };
  if (!isAddress(address)) return {};
  try {
    const meta = await rhcPublicClient.readContract({ address, abi: campaignAbi, functionName: 'tokenMeta' }) as { name: string; symbol: string; description: string };
    const title = `$${meta.symbol} — ${meta.name} · ProofLaunch on Robinhood Chain`;
    const description = (meta.description || 'A community-pooled token launch on Robinhood Chain. Back it, own the float, earn the fee stream.').slice(0, 200);
    const url = `${base}/rhc/campaign/${address}`;
    return {
      title, description,
      openGraph: { title, description, type: 'website', url, images: [image] },
      twitter: { card: 'summary_large_image', title, description, images: [image.url] },
    };
  } catch {
    return {};
  }
}

export default function CampaignLayout({ children }: { children: React.ReactNode }) {
  return children;
}
