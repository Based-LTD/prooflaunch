import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/ClientProviders";
import { GlassShell } from "@/components/GlassShell";

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-mono",
  display: "swap",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://prooflaunch.fun"),
  // Robinhood Chain is the front door (2026-09-19); Solana is the credential.
  // RHC pages override title/description in their own layout; everything
  // else — including the shared-link preview of "/" — reads this.
  title: "ProofLaunch | Community Token Launches on Robinhood Chain",
  description: "Pool the raise with your community, own the float, earn the fee stream in ETH or tokenized stock. Ownerless contracts enforce every promise on Robinhood Chain.",
  keywords: ["robinhood chain", "tokenized stocks", "RWA", "pons", "token launchpad", "community launch", "bonding curve", "defi", "prooflaunch", "solana"],
  openGraph: {
    title: "ProofLaunch | Community Token Launches on Robinhood Chain",
    description: "Pool the raise with your community, own the float, earn the fee stream in ETH or tokenized stock. Ownerless contracts enforce every promise on Robinhood Chain.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ProofLaunch | Community Token Launches on Robinhood Chain",
    description: "Pool the raise with your community, own the float, earn the fee stream in ETH or tokenized stock. Ownerless contracts enforce every promise on Robinhood Chain.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${mono.variable} ${sans.variable} antialiased min-h-screen`}>
        <div className="terminal-grid" aria-hidden="true" />
        <ClientProviders>
          <GlassShell>
            {children}
          </GlassShell>
        </ClientProviders>
      </body>
    </html>
  );
}
