import type { Metadata } from 'next';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import { ConfigProvider } from 'antd';
import Link from 'next/link';
import '@fontsource-variable/ibm-plex-sans/wght.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import './globals.css';
import SiteNav from '@/components/site-nav';
import { getBrand, SITE_URL } from '@/lib/api';
import { jsonLdScript, organizationJsonLd, websiteJsonLd } from '@/lib/seo';

// 字体走 npm 包本地托管（@fontsource），不引 next/font/google：
// 构建期要从 fonts.googleapis.com 拉字重，在内网/受限网络下会让 build 卡死。
// 本地 woff2 由 Next 静态托管，首屏只下载 latin 子集。

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'AsterVision Product Knowledge Center',
    template: '%s | AsterVision',
  },
  description:
    'Structured product knowledge for AsterVision AI video security: series, specifications, features, best-fit scenarios and FAQs.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'AsterVision Product Knowledge Center',
    url: SITE_URL,
    title: 'AsterVision Product Knowledge Center',
    description:
      'Structured product knowledge for AsterVision AI video security: specs, features, scenarios and FAQs.',
  },
  robots: { index: true, follow: true },
};

/** 取景框标记：四个角 + 中心点，暗示「摄像头 / 影像」，但不画一台摄像机 */
function ReticleMark() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      aria-hidden
      className="shrink-0 text-ink transition-colors duration-300 group-hover:text-signal-deep"
    >
      <path
        d="M2.5 6.5V2.5H6.5M15.5 2.5H19.5V6.5M19.5 15.5V19.5H15.5M6.5 19.5H2.5V15.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <circle cx="11" cy="11" r="1.15" fill="currentColor" className="text-signal" />
    </svg>
  );
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  const brand = await getBrand();
  const name = brand?.name ?? 'AsterVision';

  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-paper text-ink">
        <AntdRegistry>
          <ConfigProvider
            theme={{
              token: {
                // 主色取墨色而不是品牌橙：antd 的 Button / 焦点态与全站的 .btn 保持一致，
                // oxide 只留给「指针/当前状态」这类标记，不当作大面积填充
                colorPrimary: '#232019',
                colorError: '#a8412a',
                borderRadius: 0,
                colorText: '#1f1c19',
                colorTextSecondary: '#57534b',
                colorBorder: '#d3cfc6',
                colorBgBase: '#f7f5f0',
                colorBgContainerDisabled: '#e9e5dd',
                colorTextDisabled: '#8b857b',
                colorBorderDisabled: '#d3cfc6',
                fontFamily:
                  '"IBM Plex Sans Variable", ui-sans-serif, -apple-system, "PingFang SC", sans-serif',
                fontFamilyCode: '"IBM Plex Mono", ui-monospace, Menlo, monospace',
              },
            }}
          >
            <div className="grain" aria-hidden />

            <a
              href="#main"
              className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:top-3 focus-visible:left-3 focus-visible:z-50 focus-visible:bg-ink focus-visible:px-3 focus-visible:py-2 focus-visible:text-[12px] focus-visible:text-paper"
            >
              Skip to content
            </a>

            <header className="site-header sticky top-0 z-30 border-b border-rule bg-paper/90 backdrop-blur-[6px]">
              <div className="shell flex h-14 items-center justify-between gap-2 sm:gap-3">
                <Link href="/" className="group flex min-w-0 items-center gap-2 sm:gap-2.5">
                  <ReticleMark />
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[13.5px] font-semibold tracking-[-0.015em] uppercase sm:text-[15px]">
                      {name}
                    </span>
                    <span className="label hidden pt-px sm:inline">Product Knowledge</span>
                  </span>
                </Link>
                <SiteNav />
              </div>
            </header>

            <main id="main" className="shell relative z-10 flex-1 pt-10 pb-20 sm:pt-14">
              {children}
            </main>

            <footer className="site-footer relative z-10 border-t border-rule bg-paper-2">
              <div className="shell grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr]">
                <div className="flex flex-col gap-3">
                  <span className="label">Publisher</span>
                  <p className="text-[13.5px] leading-6 text-ink-2">
                    <span className="font-medium text-ink uppercase">{name}</span>
                    {brand?.headquarters ? ` · ${brand.headquarters}` : ''}
                    {brand?.foundedYear ? ` · Founded ${brand.foundedYear}` : ''}
                  </p>
                  {brand?.description && (
                    <p className="max-w-[38ch] text-[13px] leading-6 text-ink-3">
                      {brand.description}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-3">
                  <span className="label">Sections</span>
                  <ul className="flex flex-col gap-1.5 text-[13.5px]">
                    {[
                      { href: '/products', label: 'Product catalogue' },
                      { href: '/scenarios', label: 'Deployment scenarios' },
                      { href: '/ask', label: 'Ask the knowledge base' },
                    ].map((l) => (
                      <li key={l.href}>
                        <Link
                          href={l.href}
                          className="text-ink-2 underline-offset-4 transition hover:text-ink hover:underline"
                        >
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex flex-col gap-3">
                  <span className="label">About this site</span>
                  <p className="text-[13px] leading-6 text-ink-3">
                    Every page is generated from one structured dataset. Answers on this site are
                    retrieved from the same pages and always cite their source.
                  </p>
                </div>
              </div>

              <div className="shell flex flex-col gap-1 border-t border-rule py-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="label">
                  © {new Date().getFullYear()} {name}
                </span>
                <span className="label">Structured knowledge · Citation-first answers</span>
              </div>
            </footer>
          </ConfigProvider>
        </AntdRegistry>

        {brand && (
          <>
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{ __html: jsonLdScript(organizationJsonLd(brand)) }}
            />
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{ __html: jsonLdScript(websiteJsonLd(brand)) }}
            />
          </>
        )}
      </body>
    </html>
  );
}
