/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'img.society6.com' },
      { protocol: 'https', hostname: 'society6.com' },
      { protocol: 'https', hostname: '*.society6.com' },
    ],
  },
};

module.exports = nextConfig;
