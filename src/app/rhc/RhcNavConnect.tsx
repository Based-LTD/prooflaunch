'use client';

// The navbar wallet button for /rhc — sits where the SOL world shows
// WalletMultiButton, so both chains have the same chrome. The navbar
// mounts OUTSIDE the /rhc layout's provider tree, so this wraps itself
// in a WagmiProvider around the same singleton config; connection state
// lives on the config and is shared with the pages.
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { wagmiConfig } from './providers';
import { ConnectButton } from './components';

export default function RhcNavConnect() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectButton />
      </QueryClientProvider>
    </WagmiProvider>
  );
}
