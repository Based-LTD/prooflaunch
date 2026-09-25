'use client';

// Wagmi provider scoped to /rhc only — the rest of the site stays pure
// Solana. Injected connector covers Phantom's EVM side (and MetaMask/Rabby).
import { WagmiProvider, createConfig, fallback, http } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { robinhoodChain, RHC_RPC_URLS } from '@/lib/rhc';
import { useState } from 'react';

// Exported singleton: the navbar's RHC connect button wraps itself in its
// own WagmiProvider around this SAME config (the navbar renders outside
// the /rhc layout tree), so connection state stays shared — wagmi keeps
// state on the config object, not the provider.
// Robinhood Wallet is a phone app, not a browser extension, so a desktop
// backer has no injected provider for it — WalletConnect's QR is the only
// way in. Without a project id the connector is simply absent (nothing
// breaks; the picker just shows the extensions).
const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WC_PROJECT_ID ?? '';

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [
    injected(),
    ...(WC_PROJECT_ID
      ? [walletConnect({
          projectId: WC_PROJECT_ID,
          showQrModal: true,
          metadata: {
            name: 'ProofLaunch',
            description: 'Pooled token launches on Robinhood Chain',
            url: 'https://prooflaunch.fun',
            icons: ['https://prooflaunch.fun/images/pl-logo-rhc-400.png'],
          },
        })]
      : []),
  ],
  transports: { [robinhoodChain.id]: fallback(RHC_RPC_URLS.map((u) => http(u))) },
});

export function RhcProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
