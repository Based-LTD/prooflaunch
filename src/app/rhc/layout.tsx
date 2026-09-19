import { RhcProviders } from './providers';

export const metadata = {
  title: 'ProofLaunch on Robinhood Chain — prooflaunch.fun',
  description:
    'Community-pooled token launches on Robinhood Chain. Pool the raise, own the float, earn the fees — enforced by ownerless contracts, not promises.',
};

export default function RhcLayout({ children }: { children: React.ReactNode }) {
  return <RhcProviders>{children}</RhcProviders>;
}
