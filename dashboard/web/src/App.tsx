import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from 'antd';
import { ThunderboltOutlined } from '@ant-design/icons';
import type {
  DashboardResponse,
  MetaResponse,
  Paginated,
  RecordItem,
} from './api/types';
import { useApi } from './api/useApi';
import { FilterBar } from './components/FilterBar';
import { KpiStrip } from './components/KpiStrip';
import { Masthead } from './components/Masthead';
import { RecordDrawer } from './components/RecordDrawer';
import {
  RecordsSheet,
  type RecordFilterState,
} from './components/RecordsSheet';
import { SectionHead } from './components/SectionHead';
import { ChartEmpty, ChartSkeleton, ErrorNotice } from './components/States';
import { InsightDrawer } from './components/insight/InsightDrawer';
import { ConversionPanel } from './components/charts/ConversionPanel';
import { PlatformGap } from './components/charts/PlatformGap';
import { TopicBars } from './components/charts/TopicBars';
import { TrendChart } from './components/charts/TrendChart';
import { useDebounced } from './hooks/useDebounced';
import { CHART } from './lib/constants';
import { prettyDate, ratioPct } from './lib/format';

interface Selection {
  brand: string | null;
  from: string | null;
  to: string | null;
}

const INITIAL_FILTERS: RecordFilterState = {
  platforms: [],
  mentioned: 'all',
  keyword: '',
  page: 1,
  pageSize: 20,
  sortBy: 'date',
  sortDir: 'desc',
};

function readSelection(): Selection {
  const params = new URLSearchParams(window.location.search);
  return {
    brand: params.get('brand'),
    from: params.get('from'),
    to: params.get('to'),
  };
}

export default function App() {
  const [selection, setSelection] = useState<Selection>(readSelection);
  const [recordFilters, setRecordFilters] = useState<RecordFilterState>(INITIAL_FILTERS);
  const [openId, setOpenId] = useState<number | null>(() => {
    const raw = new URLSearchParams(window.location.search).get('record');
    const parsed = raw ? Number(raw) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  });
  const [insightOpen, setInsightOpen] = useState(false);

  const meta = useApi<MetaResponse>('/meta', {});

  const dashParams = useMemo(
    () => ({
      brand: selection.brand ?? undefined,
      from: selection.from ?? undefined,
      to: selection.to ?? undefined,
    }),
    [selection],
  );
  const dash = useApi<DashboardResponse>('/dashboard', dashParams);

  const brand = dash.data?.brand ?? selection.brand ?? meta.data?.brand ?? '';

  const period = useMemo(() => {
    if (selection.from && selection.to) {
      return { from: selection.from, to: selection.to };
    }
    const raw = dash.data?.period;
    if (raw) {
      const [from, to] = raw.split('~');
      if (from && to) return { from, to };
    }
    return meta.data?.period ?? null;
  }, [selection.from, selection.to, dash.data, meta.data]);

  const bounds = useMemo(() => {
    const brands = meta.data?.brands ?? [];
    const match = brands.find((item) => item.name === brand) ?? brands[0];
    return match ? { from: match.from, to: match.to } : null;
  }, [meta.data, brand]);

  const handleFilter = useCallback((next: Partial<Selection>) => {
    setSelection((prev) => {
      if (next.brand && next.brand !== prev.brand) {
        return { brand: next.brand, from: next.from ?? null, to: next.to ?? null };
      }
      let from = next.from ?? prev.from;
      let to = next.to ?? prev.to;
      if (from && to && from > to) {
        if (next.from) to = next.from;
        else if (next.to) from = next.to;
      }
      return { brand: next.brand ?? prev.brand, from, to };
    });
  }, []);

  // 让筛选结果可分享：地址栏始终反映当前品牌、区间与打开的明细
  useEffect(() => {
    if (!brand || !period) return;
    const params = new URLSearchParams({
      brand,
      from: period.from,
      to: period.to,
    });
    if (openId !== null) params.set('record', String(openId));
    window.history.replaceState(null, '', `?${params.toString()}`);
  }, [brand, period, openId]);

  const debouncedKeyword = useDebounced(recordFilters.keyword, 320);

  const recordParams = useMemo(
    () => ({
      brand: brand || undefined,
      from: period?.from,
      to: period?.to,
      platform: recordFilters.platforms,
      mentioned:
        recordFilters.mentioned === 'all' ? undefined : recordFilters.mentioned,
      keyword: debouncedKeyword.trim() || undefined,
      page: recordFilters.page,
      page_size: recordFilters.pageSize,
      sort_by: recordFilters.sortBy,
      sort_dir: recordFilters.sortDir,
    }),
    [
      brand,
      period?.from,
      period?.to,
      recordFilters.platforms,
      recordFilters.mentioned,
      recordFilters.page,
      recordFilters.pageSize,
      recordFilters.sortBy,
      recordFilters.sortDir,
      debouncedKeyword,
    ],
  );

  const records = useApi<Paginated<RecordItem>>(
    '/records',
    recordParams,
    Boolean(brand && period),
  );

  useEffect(() => {
    setRecordFilters((prev) => (prev.page === 1 ? prev : { ...prev, page: 1 }));
  }, [
    recordFilters.platforms,
    recordFilters.mentioned,
    debouncedKeyword,
    period?.from,
    period?.to,
    brand,
  ]);

  const resetFilters = useCallback(() => setRecordFilters(INITIAL_FILTERS), []);
  const closeDrawer = useCallback(() => setOpenId(null), []);

  const summary = dash.data?.summary ?? null;
  const platforms = dash.data?.platforms ?? [];
  const topics = dash.data?.topics ?? [];
  const trend = dash.data?.trend ?? [];

  const gapLeader = useMemo(() => {
    if (platforms.length === 0) return null;
    return [...platforms]
      .map((item) => ({
        ...item,
        recRate: ratioPct(item.recommendations, item.question_count),
        gap: item.visibility - ratioPct(item.recommendations, item.question_count),
      }))
      .sort((a, b) => b.gap - a.gap)[0];
  }, [platforms]);

  const topicRange = useMemo(() => {
    if (topics.length === 0) return null;
    const sorted = [...topics].sort((a, b) => b.visibility - a.visibility);
    return { high: sorted[0], low: sorted[sorted.length - 1] };
  }, [topics]);

  const hasError = Boolean(dash.error || meta.error);
  const errorMessage = dash.error ?? meta.error ?? '';

  return (
    <>
      {/* <a className="skip-link" href="#detail-table">
        跳到回答明细
      </a> */}
      <div className="masthead__container">
        <div className="shell px-0 ">
          <Masthead
            brand={brand || null}
            period={period}
            summary={summary}
            platformCount={platforms.length || meta.data?.platforms.length || null}
            topicCount={topics.length || meta.data?.topics.length || null}
          />
        </div>
      </div>
      <FilterBar
        brands={meta.data?.brands ?? []}
        brand={brand}
        from={period?.from ?? ''}
        to={period?.to ?? ''}
        bounds={bounds}
        pending={dash.loading || meta.loading}
        onChange={handleFilter}
        // 入口放在吸顶的筛选栏里：页面滚到任何位置它都在
        action={
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            className="insight-entry"
            aria-label="AI Insight"
            onClick={() => setInsightOpen(true)}
          >
            {/* 620 以下这行字会被 CSS 收掉，按钮变圆形图标 */}
            <span className="insight-entry__text">AI Insight</span>
          </Button>
        }
      />

      <main className="shell">
        <KpiStrip summary={summary} loading={dash.loading} />

        {hasError && (
          <div style={{ marginTop: 20 }}>
            <ErrorNotice
              title="指标加载失败"
              message={errorMessage}
              onRetry={() => {
                dash.reload();
                meta.reload();
              }}
            />
          </div>
        )}

        <section className="section" aria-labelledby="section-trend">
          <SectionHead
            index="01"
            title="可见度走势"
            id="section-trend"
            note={period ? `${prettyDate(period.from)} — ${prettyDate(period.to)} · 按日聚合` : '—'}
          />

          <div className="section__body chart-grid">
            <div className="chart-block span-8">
              <div className="chart-block__head">
                <h3 className="chart-block__title">每日可见度与 7 日滚动</h3>
                <span className="chart-block__sub">纵轴 0–100%</span>
              </div>
              <div className="chart-block__body">
                <div className="legend" style={{ marginBottom: 10 }}>
                  <span className="legend__item">
                    <i
                      className="legend__swatch"
                      style={{ background: CHART.accentFaint, height: 9, width: 9 }}
                    />
                    当日可见度
                  </span>
                  <span className="legend__item">
                    <i className="legend__swatch" style={{ background: CHART.ink }} />
                    7 日滚动均值
                  </span>
                  <span className="legend__item">
                    <i
                      className="legend__swatch"
                      style={{
                        background: 'transparent',
                        borderTop: `1px dashed ${CHART.ruleStrong}`,
                        height: 1,
                      }}
                    />
                    区间整体 {summary ? summary.visibility_score : '—'}%
                  </span>
                </div>

                {dash.loading && !dash.data ? (
                  <ChartSkeleton height={300} />
                ) : trend.length > 0 && summary ? (
                  <TrendChart data={trend} overall={summary.visibility_score} />
                ) : (
                  <ChartEmpty hint="换一个日期区间试试。" />
                )}

                <p className="chart-foot">
                  每天只有 4 条样本，单日可见度只能落在 0/25/50/75/100 五档上；
                  判断真实走势请看墨色滚动线，而不是柱子的锯齿。
                </p>
              </div>
            </div>

            <div className="chart-block span-4">
              <div className="chart-block__head">
                <h3 className="chart-block__title">提及 → 推荐 转化</h3>
                <span className="chart-block__sub">
                  {summary ? `全部 ${summary.questions_analyzed} 次提问` : '—'}
                </span>
              </div>
              <div className="chart-block__body">
                {summary ? (
                  <ConversionPanel summary={summary} />
                ) : (
                  <ChartSkeleton height={260} />
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="section-spread">
          <SectionHead
            index="02"
            title="平台与主题"
            id="section-spread"
            note="可见度 = 提及次数 ÷ 该维度提问数"
          />

          <div className="section__body chart-grid">
            <div className="chart-block span-7">
              <div className="chart-block__head">
                <h3 className="chart-block__title">各平台：可见度 vs 推荐率</h3>
                <span className="chart-block__sub">按可见度排序</span>
              </div>
              <div className="chart-block__body">
                <div className="legend" style={{ marginBottom: 10 }}>
                  <span className="legend__item">
                    <i className="legend__swatch legend__swatch--dot" style={{ background: CHART.accent }} />
                    可见度
                  </span>
                  <span className="legend__item">
                    <i className="legend__swatch legend__swatch--hollow" />
                    推荐率
                  </span>
                  <span className="legend__item" style={{ color: 'var(--faint)' }}>
                    右侧：可见度 / 推荐率
                  </span>
                </div>

                {dash.loading && !dash.data ? (
                  <ChartSkeleton height={240} />
                ) : platforms.length > 0 ? (
                  <PlatformGap data={platforms} />
                ) : (
                  <ChartEmpty hint="该区间没有平台数据。" />
                )}

                <p className="chart-foot">
                  {gapLeader
                    ? `${gapLeader.name} 可见度 ${gapLeader.visibility}%，推荐率只有 ${gapLeader.recRate}%——${gapLeader.gap} 分的落差是全平台最大，说明它「提过」但不太「愿意推」。`
                    : '两点之间的距离，就是「提到了却没被推荐」的差距。'}
                </p>
              </div>
            </div>

            <div className="chart-block span-5">
              <div className="chart-block__head">
                <h3 className="chart-block__title">主题可见度</h3>
                <span className="chart-block__sub">每个主题 15 次提问</span>
              </div>
              <div className="chart-block__body">
                {dash.loading && !dash.data ? (
                  <ChartSkeleton height={300} />
                ) : topics.length > 0 ? (
                  <TopicBars data={topics} />
                ) : (
                  <ChartEmpty hint="该区间没有主题数据。" />
                )}

                <p className="chart-foot">
                  {topicRange
                    ? `最高 ${topicRange.high.topic}（${topicRange.high.visibility}%），最低 ${topicRange.low.topic}（${topicRange.low.visibility}%）。差距说明 AI 对品牌的认知并不均匀，弱项主题需要内容补齐。`
                    : '按主题看可见度差异，找到品牌最容易被忽略的提问场景。'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="section" aria-labelledby="section-records">
          <SectionHead
            index="03"
            title="回答明细"
            id="section-records"
            note="点击任意一行查看原始回答与引用"
          />
          <div className="section__body">
            <RecordsSheet
              data={records.data}
              loading={records.loading}
              error={records.error}
              platforms={meta.data?.platforms ?? []}
              filters={recordFilters}
              onFilters={(patch) => setRecordFilters((prev) => ({ ...prev, ...patch }))}
              onSelect={setOpenId}
              onReset={resetFilters}
              onRetry={records.reload}
            />
          </div>
        </section>

        <footer className="colophon">
          {/* <p>
            口径：可见度 = 提到品牌的问题数 ÷ 该维度问题总数；推荐率 = 推荐数 ÷ 提问总数。
            百分比按银行家舍入取整（62.5 → 62），与源数据完全一致。所有数字均由 120 条回答明细聚合得出，
            不做预计算快照。
          </p>
          <p>
            <code>/api/dashboard</code> · <code>/api/records</code> ·{' '}
            <code>/api/insight/chat</code> · AntV G2
          </p> */}
        </footer>
      </main>

      <RecordDrawer id={openId} onClose={closeDrawer} />

      <InsightDrawer
        open={insightOpen}
        onClose={() => setInsightOpen(false)}
        brand={brand || null}
        period={period}
        // 从会话列表切到别的区间时，看板跟着切过去，两边始终同源
        onScopeChange={handleFilter}
      />
    </>
  );
}
