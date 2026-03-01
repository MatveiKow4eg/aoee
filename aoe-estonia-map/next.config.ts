import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  images: {
    remotePatterns: [{ protocol: "https", hostname: "www.aoe2insights.com" }],
  },
};

export default nextConfig;
