import type { Metadata } from "next";
import { Inter, Bebas_Neue } from "next/font/google";
import "./globals.css";
import { ClientProviders } from "@/components/ClientProviders";

const inter = Inter({
  subsets: ["latin"],
  display: 'swap',
});

const bebasNeue = Bebas_Neue({
  weight: '400',
  subsets: ["latin"],
  display: 'swap',
  variable: '--font-soviet',
});

export const metadata: Metadata = {
  metadataBase: new URL("https://commielaunch.fun"),
  title: "Commie Launch | Seize the Memes of Production",
  description: "The people's meme coin launchpad. Communities unite BEFORE tokens launch. Back memes you believe in, share in the revolution.",
  keywords: ["solana", "meme coin", "launchpad", "bonding curve", "defi", "commie launch", "communist", "memes"],
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    title: "Commie Launch | Seize the Memes of Production",
    description: "The people's meme coin launchpad. Communities unite BEFORE tokens launch.",
    images: ["/images/og-image.jpg"],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Commie Launch | Seize the Memes of Production",
    description: "The people's meme coin launchpad. Communities unite BEFORE tokens launch.",
    images: ["/images/og-image.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} ${bebasNeue.variable} antialiased min-h-screen`}>
        {/* Parallax Background */}
        <div className="parallax-bg" aria-hidden="true" />
        <div className="parallax-overlay" aria-hidden="true" />

        {/* Content */}
        <div className="content-layer">
          <ClientProviders>
            {children}
          </ClientProviders>
        </div>
      </body>
    </html>
  );
}
// Force rebuild Wed Jan 28 10:28:36 MST 2026
