import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pages builds export static files; ordinary builds retain the server APIs.
  output: process.env.NEXT_PUBLIC_STATIC_EXPORT === 'true' ? 'export' : undefined,
  trailingSlash: process.env.NEXT_PUBLIC_STATIC_EXPORT === 'true',
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',

  // 下面这些可以保留
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true, // 忽略 TS 错误，方便快速部署
  },
};

export default nextConfig;
