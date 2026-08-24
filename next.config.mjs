/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: [
    '@aws-sdk/client-s3',
    '@aws-sdk/client-ivs',
    '@aws-sdk/client-cognito-identity-provider',
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/lib-dynamodb',
    '@aws-sdk/s3-request-presigner',
    '@smithy/node-http-handler'
  ]
};

export default nextConfig;
