import type { Metadata } from 'next';

const title = 'The $PLAUNCH Flywheel · ProofLaunch on Robinhood Chain';
import { V8_LIVE } from '@/lib/rhc';
const description = V8_LIVE
  ? 'Every trade on every token launched through the flywheel factory buys and burns $PLAUNCH. Live counters, burns per day, which launches feed it and who cranks it — all read from the chain.'
  : 'Every trade on tokens launched through the flywheel factory will buy and burn $PLAUNCH. Counters, burns per day, which launches feed it and who cranks it — all read from the chain.';
export const metadata: Metadata = {
  title, description,
  openGraph: { title, description, type: 'website', url: 'https://prooflaunch.fun/rhc/flywheel', images: [{ url: 'https://prooflaunch.fun/opengraph-image', width: 1200, height: 630 }] },
  twitter: { card: 'summary_large_image', title, description, images: ['https://prooflaunch.fun/opengraph-image'] },
};
export default function FlywheelLayout({ children }: { children: React.ReactNode }) { return children; }
