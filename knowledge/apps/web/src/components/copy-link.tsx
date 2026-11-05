'use client';

import { useState } from 'react';

/**
 * 复制永久链接。用 window.location.origin 现算绝对地址，
 * 避免把构建期的 SITE_URL 写死进客户端产物（预览域名和正式域名会不一致）。
 */
export default function CopyLink({ path }: { path: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
      setState('done');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 1800);
  }

  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="group inline-flex items-center gap-1.5 text-left transition-colors duration-200 hover:text-ink"
      aria-label={`Copy link to ${path}`}
    >
      <span className="code text-[11px]">{path}</span>
      <span
        className={`label text-[10px] transition-opacity duration-200 ${
          state === 'idle' ? 'opacity-75 group-hover:text-signal-deep group-hover:opacity-100' : 'opacity-100'
        } ${state === 'done' ? 'text-signal-deep' : ''}`}
      >
        {state === 'done' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}
      </span>
    </button>
  );
}
