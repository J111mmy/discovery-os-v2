/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["inngest"],
  },
};

module.exports = nextConfig;
