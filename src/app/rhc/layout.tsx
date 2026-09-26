import { RhcProviders } from './providers';

const title = 'ProofLaunch on Robinhood Chain · prooflaunch.fun';
const description =
  'Community-pooled token launches on Robinhood Chain. Pool the raise, own the float, earn the fees in ETH or tokenized stock, enforced by ownerless contracts, not promises.';

export const metadata = {
  title,
  description,
  // Without these the shared-link card inherits the ROOT openGraph title.
  // The image must be repeated here: a nested openGraph object REPLACES the
  // root one, so without it X renders a card with no picture (or a stale one).
  openGraph: { title, description, type: 'website', images: [{ url: 'https://prooflaunch.fun/opengraph-image', width: 1200, height: 630, alt: 'ProofLaunch on Robinhood Chain' }] },
  twitter: { card: 'summary_large_image', title, description, images: ['https://prooflaunch.fun/opengraph-image'] },
};

export default function RhcLayout({ children }: { children: React.ReactNode }) {
  return <RhcProviders>{children}</RhcProviders>;
}
