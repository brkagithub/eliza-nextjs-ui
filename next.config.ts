import type { NextConfig } from 'next';
import { webpack } from 'next/dist/compiled/webpack/webpack';

const nextConfig: NextConfig = {
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production',
  },
  experimental: {
    inlineCss: true,
    // Optimize bundling for faster builds
    optimizePackageImports: ['@radix-ui/react-icons', 'lucide-react'],
  },
  // Turbopack is now stable, moved from experimental.turbo
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
  webpack: (config, { dev, isServer }) => {
    // Performance optimizations for development
    if (dev) {
      config.cache = {
        type: 'filesystem',
        buildDependencies: {
          config: [__filename],
        },
      };
      
      // Reduce bundle analysis overhead
      config.optimization = {
        ...config.optimization,
        removeAvailableModules: false,
        removeEmptyChunks: false,
        splitChunks: false,
      };
    }

    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^pg-native$|^cloudflare:sockets$/,
      }),
      // Ignore the elizaos directory using checkResource
      new webpack.IgnorePlugin({
        checkResource(resource, context) {
          // Ignore anything within the elizaos directory
          return /elizaos\//.test(context);
        },
      }),
      // Ignore aubrai-old-ui for faster builds
      new webpack.IgnorePlugin({
        checkResource(resource, context) {
          return /aubrai-old-ui\//.test(context);
        },
      })
    );
    
    // Return modified config
    return {
      ...config,
      resolve: {
        ...config.resolve,
        // Speed up module resolution
        symlinks: false,
        fallback: {
          ...config.resolve?.fallback,
          fs: false,
          net: false,
          tls: false,
          async_hooks: false,
          worker_threads: false,
        },
      },
    };
  },
  async redirects() {
    return [];
  },
  async rewrites() {
    return [
      {
        source: "/relay-cAnL/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/relay-cAnL/:path*",
        destination: "https://eu.i.posthog.com/:path*",
      },
      {
        source: "/relay-cAnL/flags",
        destination: "https://eu.i.posthog.com/flags",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true, 
}
export default nextConfig;
