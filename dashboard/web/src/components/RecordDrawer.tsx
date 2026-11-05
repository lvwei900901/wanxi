import { Alert, Button, Drawer, Empty, Skeleton, Tag } from 'antd';
import type { RecordDetail } from '../api/types';
import { useRecordDetail } from '../api/useApi';
import { platformColor, sentimentLabel, sourceTypeLabel } from '../lib/constants';
import { hostOf, prettyDate } from '../lib/format';

interface Props {
  id: number | null;
  onClose: () => void;
}

export function RecordDrawer({ id, onClose }: Props) {
  const { data, loading, error, reload } = useRecordDetail<RecordDetail>(id);

  return (
    <Drawer
      open={id !== null}
      onClose={onClose}
      width={624}
      placement="right"
      styles={{ body: { padding: '22px 26px 56px' }, header: { padding: '16px 26px' } }}
      title={<span className="mono-label">回答详情 · #{data?.source_id ?? id ?? ''}</span>}
    >
      {loading && !data && <Skeleton active paragraph={{ rows: 6 }} />}

      {error && (
        <Alert
          type="error"
          showIcon
          message="这条回答加载失败"
          description={error}
          action={
            <Button size="small" onClick={reload}>
              重试
            </Button>
          }
        />
      )}

      {!error && !loading && !data && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有找到这条回答" />
      )}

      {data && (
        <article>
          <div className="detail__kicker">
            <Tag bordered={false}>{prettyDate(data.date)}</Tag>
            <span className="cell-platform">
              <i
                className="cell-platform__dot"
                style={{ background: platformColor(data.platform) }}
                aria-hidden="true"
              />
              {data.platform}
            </span>
            <Tag bordered={false}>{data.topic}</Tag>
            <Tag bordered={false}>意图 {data.intent_type}</Tag>
            <Tag
              bordered={false}
              color={
                data.sentiment === 'positive'
                  ? 'success'
                  : data.sentiment === 'negative'
                    ? 'error'
                    : data.sentiment === 'mixed'
                      ? 'warning'
                      : 'default'
              }
            >
              {sentimentLabel(data.sentiment)}
            </Tag>
          </div>

          <h2 className="detail__question">{data.question}</h2>

          <dl className="detail__grid">
            <div className="detail__cell">
              <dt className="mono-label">品牌提及</dt>
              <dd>{data.brand_mentioned ? '已提及' : '未提及'}</dd>
            </div>
            <div className="detail__cell">
              <dt className="mono-label">推荐</dt>
              <dd>
                {data.brand_recommended
                  ? '进入推荐'
                  : data.brand_mentioned
                    ? '提及未推荐'
                    : '未提及'}
              </dd>
            </div>
            <div className="detail__cell">
              <dt className="mono-label">引用来源</dt>
              <dd>
                <strong>{data.citation_count}</strong> 条
              </dd>
            </div>
          </dl>

          <section className="detail__block">
            <h3>回答摘要</h3>
            <p className="detail__quote">{data.answer_excerpt}</p>
          </section>

          <section className="detail__block">
            <h3>提及产品</h3>
            {data.mentioned_products.length > 0 ? (
              <div className="products">
                {data.mentioned_products.map((product) => (
                  <span className="product" key={product}>
                    {product}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-[12.5px] text-faint">本条回答没有标注具体产品型号</p>
            )}
          </section>

          <section className="detail__block">
            <h3>引用来源 · {data.citations.length}</h3>
            {data.citations.length > 0 ? (
              <ol className="cite-list">
                {data.citations.map((citation, index) => (
                  <li className="cite" key={citation.url}>
                    <span className="cite__idx">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <div className="cite__title">
                        <a
                          href={citation.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={citation.url}
                        >
                          {citation.title}
                        </a>
                      </div>
                      <div className="cite__meta">
                        <span>{hostOf(citation.url)}</span>
                        <span className="dot" />
                        <Tag bordered={false}>{sourceTypeLabel(citation.source_type)}</Tag>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12.5px] text-faint">这条回答没有给出引用来源</p>
            )}
          </section>
        </article>
      )}
    </Drawer>
  );
}
