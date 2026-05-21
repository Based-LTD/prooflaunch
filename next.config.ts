import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Legacy domain redirects: commielaunch.fun was the original brand;
  // canonical is now prooflaunch.fun. Any request hitting the old
  // domain (apex or www) gets 301'd to the same path on the new one.
  // This forces social-platform link-preview caches to refresh to the
  // correct "Proof Launch" OG metadata instead of the cached legacy one.
  async redirects() {
    return [
      {
        source: "/:path*",
        destination: "https://prooflaunch.fun/:path*",
        permanent: true,
        has: [{ type: "host", value: "commielaunch.fun" }],
      },
      {
        source: "/:path*",
        destination: "https://prooflaunch.fun/:path*",
        permanent: true,
        has: [{ type: "host", value: "www.commielaunch.fun" }],
      },
    ];
  },
};

export default nextConfig;
