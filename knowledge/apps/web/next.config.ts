import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // cacheComponents 是 Next 16 的实验开关：开启后路由文件不能再写 dynamic / revalidate，
  // 未缓存的取数还必须包 Suspense。内容站要的是标准 ISR 语义（revalidate + tag 失效），
  // 这里显式关掉，避免把生产页面建在实验 API 上。
  cacheComponents: false,
  // 允许通过环境变量换输出目录：CI 或多版本并行构建时避免抢 .next/lock
  distDir: process.env.NEXT_DIST_DIR || '.next',
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
