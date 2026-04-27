import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/ClientProviders";

const inter = Inter({
  subsets: ["latin"],
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL("https://prooflaunch.fun"),
  title: "Proof Launch | Community-Curated Meme Coin Launchpad",
  description: "The first meme coin launchpad where communities form BEFORE tokens launch. Back memes you believe in, earn fees from trading.",
  keywords: ["solana", "meme coin", "launchpad", "bonding curve", "defi", "proof launch"],
  openGraph: {
    title: "Proof Launch | Community-Curated Meme Coin Launchpad",
    description: "Communities form BEFORE tokens launch. Back memes you believe in, earn fees from trading.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Proof Launch | Community-Curated Meme Coin Launchpad",
    description: "Communities form BEFORE tokens launch. Back memes you believe in, earn fees from trading.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} antialiased min-h-screen`}>
        <ClientProviders>
          {children}
        </ClientProviders>
      </body>
    </html>
  );
}
