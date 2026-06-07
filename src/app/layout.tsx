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
  title: "Proof Launch | Community-Pre-Formed Token Launchpad",
  description: "The launchpad where communities form BEFORE tokens launch. Back projects you believe in and participate in community-driven launches.",
  keywords: ["solana", "token launchpad", "launchpad", "bonding curve", "defi", "proof launch", "pump.fun"],
  openGraph: {
    title: "Proof Launch | Community-Pre-Formed Token Launchpad",
    description: "Communities form BEFORE tokens launch. Back projects you believe in and participate in community-driven launches.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Proof Launch | Community-Pre-Formed Token Launchpad",
    description: "Communities form BEFORE tokens launch. Back projects you believe in and participate in community-driven launches.",
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
