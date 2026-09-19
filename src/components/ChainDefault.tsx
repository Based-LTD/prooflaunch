'use client';

// Front door. Robinhood Chain is the default world now: a first visit to
// "/" goes straight to /rhc, with no chooser in the way. Anyone who has
// ever picked SOL (the navbar toggle writes the preference) keeps landing
// on the Solana board — only fresh visitors are routed. Deep links are
// never touched; this only mounts on "/".
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function ChainDefault() {
  const router = useRouter();
  useEffect(() => {
    try {
      if (localStorage.getItem('pl-chain') !== 'sol') router.replace('/rhc');
    } catch {
      // storage blocked — fall through to the page as rendered
    }
  }, [router]);
  return null;
}
