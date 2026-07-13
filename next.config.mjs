/** @type {import('next').NextConfig} */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''

const nextConfig = {
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // Permite o Bitrix24 embutir o app em iframe (remove bloqueio padrão do Next.js)
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options",          value: "ALLOWALL" },
          { key: "Content-Security-Policy",   value: "frame-ancestors *" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },

  // Configurações mínimas
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Configurações para AWS SDK
  webpack: (config, { isServer }) => {
    // Configurações específicas para AWS SDK
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
      }
    }

    // Ignorar warnings do AWS SDK
    config.ignoreWarnings = [
      { module: /node_modules\/aws-sdk/ },
      { file: /node_modules\/aws-sdk/ },
    ]

    return config
  },
  // Configurações experimentais para melhor compatibilidade
  experimental: {
    serverComponentsExternalPackages: ['aws-sdk', 'pg', 'pg-native', '@aws-sdk/client-cloudwatch-logs', '@aws-sdk/client-lambda'],
    // Libera Server Actions para chamadas vindas do Bitrix24 e ngrok
    serverActions: {
      allowedOrigins: [
        'interatell.bitrix24.com.br',
        'intc02.int.intcloud.com.br',
        '*.ngrok-free.app',
        '*.ngrok-free.dev',
        '*.ngrok.io',
        'localhost:3000',
      ],
    },
  },
}

export default nextConfig
