import { Alert, Button, Input, Pagination, Segmented, Select, Table, Tag } from 'antd';
import type { TableProps } from 'antd';
import type { Paginated, RecordItem } from '../api/types';
import { platformColor, sentimentLabel } from '../lib/constants';
import { monthDay } from '../lib/format';

export type MentionFilter = 'all' | 'true' | 'false';
export type SortField = 'date' | 'platform' | 'topic' | 'question' | 'citations';

export interface RecordFilterState {
  platforms: string[];
  mentioned: MentionFilter;
  keyword: string;
  page: number;
  pageSize: number;
  sortBy: SortField;
  sortDir: 'asc' | 'desc';
}

interface Props {
  data: Paginated<RecordItem> | null;
  loading: boolean;
  error: string | null;
  platforms: { name: string; record_count: number }[];
  filters: RecordFilterState;
  onFilters: (patch: Partial<RecordFilterState>) => void;
  onSelect: (id: number) => void;
  onReset: () => void;
  onRetry: () => void;
}

export function RecordsSheet({
  data,
  loading,
  error,
  platforms,
  filters,
  onFilters,
  onSelect,
  onReset,
  onRetry,
}: Props) {
  const total = data?.total ?? 0;
  const page = data?.page ?? filters.page;
  const pageSize = data?.page_size ?? filters.pageSize;
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const sortOrderOf = (field: SortField) =>
    filters.sortBy === field ? (filters.sortDir === 'asc' ? 'ascend' : 'descend') : null;

  const columns: TableProps<RecordItem>['columns'] = [
    {
      title: '日期',
      dataIndex: 'date',
      width: 92,
      sorter: true,
      sortOrder: sortOrderOf('date'),
      render: (value: string) => <span className="cell-date">{monthDay(value)}</span>,
    },
    {
      title: '平台',
      dataIndex: 'platform',
      width: 132,
      sorter: true,
      sortOrder: sortOrderOf('platform'),
      render: (value: string) => (
        <span className="cell-platform">
          <i
            className="cell-platform__dot"
            style={{ background: platformColor(value) }}
            aria-hidden="true"
          />
          {value}
        </span>
      ),
    },
    {
      title: '主题',
      dataIndex: 'topic',
      width: 172,
      ellipsis: true,
      sorter: true,
      sortOrder: sortOrderOf('topic'),
      render: (value: string) => <span className="cell-topic">{value}</span>,
    },
    {
      title: '问题',
      dataIndex: 'question',
      ellipsis: true,
      sorter: true,
      sortOrder: sortOrderOf('question'),
      render: (value: string) => <span className="cell-question">{value}</span>,
    },
    {
      title: '提及',
      dataIndex: 'brand_mentioned',
      width: 88,
      render: (value: boolean) =>
        value ? (
          <span className="cell-mark">
            <i aria-hidden="true" />
            提及
          </span>
        ) : (
          <span className="cell-mark cell-mark--off">
            <i aria-hidden="true" />
            未提及
          </span>
        ),
    },
    {
      title: '推荐',
      dataIndex: 'brand_recommended',
      width: 92,
      render: (value: boolean, record) =>
        value ? (
          <span className="cell-mark cell-mark--rec">
            <i aria-hidden="true" />
            推荐
          </span>
        ) : (
          <span className="cell-mark cell-mark--off">
            <i aria-hidden="true" />
            {record.brand_mentioned ? '未推荐' : '—'}
          </span>
        ),
    },
    {
      title: '引用',
      dataIndex: 'citation_count',
      width: 74,
      align: 'right',
      sorter: true,
      sortOrder: sortOrderOf('citations'),
      render: (value: number) => (
        <span className={`cell-citations${value === 0 ? ' is-zero' : ''}`}>
          {value === 0 ? '·' : value}
        </span>
      ),
    },
    {
      title: '情绪',
      dataIndex: 'sentiment',
      width: 84,
      render: (value: string) => (
        <span className={`tag tag--${value}`}>{sentimentLabel(value)}</span>
      ),
    },
  ];

  return (
    <div>
      <div className="sheet-toolbar">
        <Select
          mode="multiple"
          allowClear
          placeholder="全部平台"
          value={filters.platforms}
          onChange={(value: string[]) => onFilters({ platforms: value, page: 1 })}
          style={{ minWidth: 216 }}
          maxTagCount="responsive"
          options={platforms.map((platform) => ({
            value: platform.name,
            label: `${platform.name}（${platform.record_count}）`,
          }))}
        />

        <Segmented
          value={filters.mentioned}
          onChange={(value) => onFilters({ mentioned: value as MentionFilter, page: 1 })}
          options={[
            { label: '全部', value: 'all' },
            { label: '已提及', value: 'true' },
            { label: '未提及', value: 'false' },
          ]}
        />

        <Input.Search
          allowClear
          placeholder="搜索问题文案"
          value={filters.keyword}
          onChange={(event) => onFilters({ keyword: event.target.value, page: 1 })}
          style={{ width: 236 }}
        />

        {(filters.platforms.length > 0 || filters.mentioned !== 'all' || filters.keyword) && (
          <Button type="link" size="small" onClick={onReset}>
            清除筛选
          </Button>
        )}

        <span className="sheet-toolbar__count" aria-live="polite">
          {loading ? (
            '正在加载…'
          ) : (
            <>
              <b>{total}</b> 条 · 第 {start}–{end} 条
            </>
          )}
        </span>
      </div>

      {error && (
        <Alert
          className="mb-4"
          type="error"
          showIcon
          message="明细加载失败"
          description={error}
          action={
            <Button size="small" onClick={onRetry}>
              重试
            </Button>
          }
        />
      )}

      {!error && data && total === 0 && (
        <div className="empty">
          <strong>这个组合下没有回答</strong>
          试试放宽日期区间，或取消平台与提及状态的筛选。
          <div className="mt-3.5">
            <Button onClick={onReset}>清除全部筛选</Button>
          </div>
        </div>
      )}

      {!error && (!data || total > 0) && (
        <div id="detail-table" tabIndex={-1}>
          <Table<RecordItem>
            rowKey="id"
            size="middle"
            columns={columns}
            dataSource={data?.items ?? []}
            loading={loading}
            pagination={false}
            scroll={{ x: 900 }}
            locale={{ emptyText: ' ' }}
            onRow={(record) => ({
              tabIndex: 0,
              className:
                'cursor-pointer focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2',
              'aria-label': `${record.platform} ${monthDay(record.date)}：${record.question}`,
              onClick: () => onSelect(record.id),
              onKeyDown: (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(record.id);
                }
              },
            })}
            onChange={(_pagination, _filters, sorter) => {
              const active = Array.isArray(sorter) ? sorter[0] : sorter;
              const field = active?.field as SortField | undefined;
              const order = active?.order;
              if (!field || !order) {
                onFilters({ sortBy: 'date', sortDir: 'desc', page: 1 });
                return;
              }
              onFilters({
                sortBy: field,
                sortDir: order === 'ascend' ? 'asc' : 'desc',
                page: 1,
              });
            }}
          />
        </div>
      )}

      {data && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <span className="font-mono text-[11px] tracking-wide text-faint">
            第 {start}–{end} 条 · 共 {total} 条
          </span>
          <Pagination
            size="small"
            current={page}
            total={total}
            pageSize={pageSize}
            showSizeChanger
            pageSizeOptions={[20, 50, 100]}
            onChange={(nextPage, nextSize) =>
              onFilters({ page: nextPage, pageSize: nextSize })
            }
          />
        </div>
      )}

      {data && total > 0 && loading && (
        <div className="mt-2 flex justify-end">
          <Tag bordered={false}>更新中</Tag>
        </div>
      )}
    </div>
  );
}
