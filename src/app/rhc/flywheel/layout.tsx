import type { Metadata } from 'next';

const title = 'The $PROOF Flywheel · ProofLaunch on Robinhood Chain';
const description = 'Every trade on every ProofLaunch token buys and burns $PROOF. Live counters, burns per day, which launches feed it, who cranks it — all read from the chain.';
export const metadata: Metadata = {
  title, description,
  openGraph: { title, description, type: 'website', url: 'https://prooflaunch.fun/rhc/flywheel', images: [{ url: 'https://prooflaunch.fun/opengraph-image', width: 1200, height: 630 }] },
  twitter: { card: 'summary_large_image', title, description, images: ['https://prooflaunch.fun/opengraph-image'] },
};
export default function FlywheelLayout({ children }: { children: React.ReactNode }) { return children; }
