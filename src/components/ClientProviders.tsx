'use client';

import { FC, ReactNode } from 'react';
import { WalletProvider } from '@/contexts/WalletProvider';
import { Navbar } from './Navbar';

interface Props {
  children: ReactNode;
}

export const ClientProviders: FC<Props> = ({ children }) => {
  return (
    <WalletProvider>
      <Navbar />
      <main className="pt-24 pb-8 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
        {children}
      </main>
    </WalletProvider>
  );
};
