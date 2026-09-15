'use client';

// Wagmi provider scoped to /rhc only — the rest of the site stays pure
// Solana. Injected connector covers Phantom's EVM side (and MetaMask/Rabby).
import { WagmiProvider, createConfig, fallback, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { robinhoodChain, RHC_RPC_URLS } from '@/lib/rhc';
import { useState } from 'react';

// Exported singleton: the navbar's RHC connect button wraps itself in its
// own WagmiProvider around this SAME config (the navbar renders outside
// the /rhc layout tree), so connection state stays shared — wagmi keeps
// state on the config object, not the provider.
export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected()],
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
