import { RhcProviders } from './providers';

const title = 'ProofLaunch on Robinhood Chain — prooflaunch.fun';
const description =
  'Community-pooled token launches on Robinhood Chain. Pool the raise, own the float, earn the fees in ETH or tokenized stock — enforced by ownerless contracts, not promises.';

export const metadata = {
  title,
  description,
  // Without these the shared-link card inherits the ROOT openGraph title.
  openGraph: { title, description, type: 'website' },
  twitter: { card: 'summary_large_image', title, description },
};

export default function RhcLayout({ children }: { children: React.ReactNode }) {
  return <RhcProviders>{children}</RhcProviders>;
}
