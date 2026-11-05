'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from 'antd';
import type { AskCitationDto, AskStreamEvent } from '@kb/contracts';

type Phase = 'idle' | 'retrieving' | 'answering' | 'done' | 'error';

const SAMPLES = [
  'Which products support 4K imaging?',
  'Which product works offline without a network?',
  'What is the difference between Nova X4 and Thermal T4?',
];

const STATUS: Record<Phase, string> = {
  idle: 'Awaiting query',
  retrieving: 'Retrieving passages',
  answering: 'Streaming answer',
  done: 'Complete',
  error: 'Failed',
};

const SOURCE_LABEL: Record<string, string> = {
  brand: 'Brand',
  series: 'Series',
  product: 'Product',
  faq: 'FAQ',
  scenario: 'Scenario',
};

export default function AskClient() {
  // 首页的示例问题通过 ?q= 传进来；在客户端读取而不是走 searchParams，
  // 这样 /ask 仍然是一个静态页（只有控制台子树在客户端水合）
  const searchParams = useSearchParams();
  const initialQuestion = searchParams.get('q') ?? '';
  const [question, setQuestion] = useState(initialQuestion);
  const [answer, setAnswer] = useState('');
  const [citations, setCitations] = useState<AskCitationDto[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [degraded, setDegraded] = useState(false);
  const [indexVersion, setIndexVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const busy = phase === 'retrieving' || phase === 'answering';

  const ask = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (q.length < 2) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setQuestion(q);
      setAnswer('');
      setCitations([]);
      setError(null);
      setDegraded(false);
      setPhase('retrieving');

      try {
        const res = await fetch('/api/ask', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ question: q, topK: 4 }),
          signal: controller.signal,
        });

        if (!res.body) throw new Error('Upstream returned no stream.');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let started = false;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // SSE 以空行分隔事件；最后一段可能不完整，留在 buffer 里等下一个 chunk
          const events = buffer.split('\n\n');
          buffer = events.pop() ?? '';

          for (const raw of events) {
            const line = raw.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            let event: AskStreamEvent;
            try {
              event = JSON.parse(line.slice(5).trim()) as AskStreamEvent;
            } catch {
              continue;
            }

            if (event.type === 'citations') {
              setCitations(event.citations);
              setPhase('answering');
              if (!started) {
                started = true;
                // 首个 token 到达前把答案区送到视口顶部，避免用户盯着按钮等
                requestAnimationFrame(() =>
                  panelRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
                );
              }
            } else if (event.type === 'token') {
              setAnswer((prev) => prev + event.value);
            } else if (event.type === 'done') {
              setDegraded(event.degraded);
              setIndexVersion(event.indexVersion);
              setPhase('done');
            } else if (event.type === 'error') {
              setError(event.message);
              setPhase('error');
            }
          }
        }

        setPhase((p) => (p === 'answering' || p === 'retrieving' ? 'done' : p));
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          setPhase((p) => (p === 'retrieving' || p === 'answering' ? 'idle' : p));
          return;
        }
        setError((err as Error).message || 'Request failed.');
        setPhase('error');
      }
    },
    [],
  );

  // 从首页的示例问题跳进来时直接执行一次；ref 防止 StrictMode 下双发
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || initialQuestion.trim().length < 2) return;
    autoRan.current = true;
    void ask(initialQuestion);
  }, [ask, initialQuestion]);

  async function copyAnswer() {
    try {
      await navigator.clipboard.writeText(answer);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="tick-frame border border-rule bg-paper-2/50">
        <div className="flex items-center justify-between gap-3 border-b border-rule px-3.5 py-2">
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className={`h-[5px] w-[5px] ${
                busy ? 'animate-pulse bg-signal' : phase === 'error' ? 'bg-signal' : 'bg-ink-3/50'
              }`}
            />
            <span className="label">Query console</span>
          </span>
          <span className="label" aria-live="polite">
            {STATUS[phase]}
          </span>
        </div>

        <label htmlFor="ask-input" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask-input"
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask(question);
            }
          }}
          rows={3}
          maxLength={300}
          placeholder="Ask about specifications, compatibility or deployment fit…"
          className="block w-full resize-none bg-transparent px-3.5 py-4 text-[15.5px] leading-7 text-ink outline-none placeholder:text-ink-3/80"
        />

        {/* 示例问句与操作条分成两条：挤在同一行时，flex-wrap 会把主按钮甩到
            左边第二行，控制台右半边整块空掉 */}
        <div className="border-t border-rule bg-paper/40">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 px-3.5 pt-2.5 pb-2.5">
            {/* 窄屏让 TRY 独占一行，否则折行后的示例问句会缩进到它下面，左边缘参差 */}
            <span className="label shrink-0 basis-full sm:basis-auto">Try</span>
            {SAMPLES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => void ask(s)}
                disabled={busy}
                className="text-left text-[12px] leading-5 text-ink-3 underline decoration-rule-2 decoration-1 underline-offset-4 transition hover:text-ink hover:decoration-ink disabled:opacity-45"
              >
                {s}
              </button>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-rule/70 px-3.5 py-2">
            <span
              className={`label truncate ${hint ? 'text-signal-deep' : 'hidden sm:inline'}`}
              aria-live="polite"
            >
              {hint
                ? 'Type at least 2 characters'
                : busy
                  ? 'Streaming — stop to cancel'
                  : 'Enter to send · Shift+Enter newline'}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-4">
              {busy && (
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="label transition hover:text-ink"
                >
                  Stop
                </button>
              )}
              <Button
                type="primary"
                loading={busy}
                onClick={() => {
                  if (question.trim().length < 2) {
                    setHint(true);
                    inputRef.current?.focus();
                    window.setTimeout(() => setHint(false), 2200);
                    return;
                  }
                  void ask(question);
                }}
                className="!h-9 !px-4 !text-[12px] !tracking-[0.1em] !uppercase ![font-family:var(--font-mono)]"
              >
                Ask
              </Button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="notice notice-warn" role="alert">
          <span className="label pt-0.5">Error</span>
          <p className="text-[13.5px] leading-6 text-ink-2">{error}</p>
        </div>
      )}

      {degraded && (
        <div className="notice notice-info">
          <span className="label pt-0.5">Degraded</span>
          <p className="text-[13.5px] leading-6 text-ink-2">
            The language model is unavailable, so retrieval ran in keyword mode. What follows are the
            closest passages in the knowledge base — not a written answer.
          </p>
        </div>
      )}

      {phase === 'idle' && !answer && citations.length === 0 && (
        <div className="border-t border-rule pt-5">
          <span className="label">Scope</span>
          <p className="prose-measure mt-2 text-[13.5px] leading-6 text-ink-2">
            Answers are limited to the{' '}
            <span className="text-ink">product documentation on this site</span>. Questions about
            pricing, stock or lead times are out of scope — the console will tell you when it
            doesn&apos;t have the material rather than improvise.
          </p>
        </div>
      )}

      {(answer || citations.length > 0) && (
        <div ref={panelRef} className="flex scroll-mt-24 flex-col gap-6">
          <div className="relative border border-rule bg-paper">
            <span aria-hidden className="absolute inset-y-0 left-0 w-[2px] bg-signal" />
            <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2 pl-5">
              <span className="label">
                Answer
                {citations.length > 0 && ` · ${citations.length} passages`}
                {indexVersion !== null && ` · index v${indexVersion}`}
              </span>
              {answer && !busy && (
                <button
                  type="button"
                  onClick={() => void copyAnswer()}
                  className={`label transition hover:text-ink ${copied ? 'text-signal-deep' : ''}`}
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              )}
            </div>
            <div className="px-5 py-4">
              <p className="prose-measure text-[15px] leading-7 whitespace-pre-wrap text-ink">
                {answer ||
                  (phase === 'retrieving' ? (
                    <span className="text-ink-3">Retrieving passages…</span>
                  ) : null)}
                {phase === 'answering' && (
                  <span
                    aria-hidden
                    className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[3px] animate-pulse bg-signal"
                  />
                )}
              </p>
            </div>
          </div>

          {citations.length > 0 && (
            <div>
              {/* 不加 § 编号：这是回答的附属信息，不是页面的一个章节 */}
              <div className="flex items-baseline gap-3 border-t border-ink/65 pt-2.5">
                <span className="label text-signal-deep">Cited</span>
                <h2 className="text-[14px] font-semibold tracking-tight">Sources</h2>
                <span aria-hidden className="mb-[3px] h-px flex-1 bg-rule-2" />
                <span className="label">From this knowledge base</span>
              </div>

              <ol className="mt-3 border-t border-rule">
                {citations.map((c) => {
                  const pct = Math.round(c.score * 100);
                  return (
                    <li key={`${c.n}-${c.urlPath}`} className="border-b border-rule">
                      <a
                        href={c.urlPath}
                        className="index-row group flex items-center gap-3 py-2.5 pr-2 pl-3"
                      >
                        <span className="code shrink-0 text-[11px] text-signal-deep">
                          [{c.n}]
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] text-ink-2 transition-colors group-hover:text-ink">
                            {c.title}
                          </span>
                        </span>
                        <span className="label hidden shrink-0 sm:inline">
                          {SOURCE_LABEL[c.sourceType] ?? c.sourceType}
                        </span>
                        <span
                          aria-hidden
                          className="hidden h-[3px] w-12 shrink-0 bg-rule sm:block"
                          title={`Relevance ${pct}%`}
                        >
                          <span
                            className="block h-full bg-signal transition-[width] duration-500 ease-out"
                            style={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
                          />
                        </span>
                        <span className="code shrink-0 text-[11px] text-ink-3 tabular-nums">
                          {pct}%
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
