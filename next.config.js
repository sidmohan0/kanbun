/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",  // Static export for Tauri
  images: {
    unoptimized: true,
  },
  experimental: {
    // Prevent dev overlay manifest mismatches in Next 15 during Tauri hot reload.
    devtoolSegmentExplorer: true,
  },
};

module.exports = nextConfig;
