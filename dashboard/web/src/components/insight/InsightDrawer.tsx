import { useMemo, useState } from 'react';
import { Bubble, Sender } from '@ant-design/x';
import { Alert, Avatar, Button, Drawer } from 'antd';
import {
  HistoryOutlined,
  PlusOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { prettyDate } from '../../lib/format';
import { InsightMarkdown } from './InsightMarkdown';
import { SessionList } from './SessionList';
import { useInsightChat, type InsightScope } from './useInsightChat';

interface Props {
  open: boolean;
  onClose: () => void;
  brand: string | null;
  period: { from: string; to: string } | null;
  /** 切到别的区间去开会话时，让看板跟着走 */
  onScopeChange?: (scope: InsightScope) => void;
}

const PRESETS = [
  '这个区间最大的问题是什么？',
  '为什么推荐率低于可见度？',
  '哪个平台最值得优先投入？',
  '哪些主题需要补内容？',
];

/**
 * 气泡的角色级默认样式：用户靠右实心，AI 靠左无框，让长文更干净。
 *
 * 头像是 RoleProps 支持的槽位，配一次就能让同类消息全部生效，
 * 不用在 map items 时逐条塞。
 */
const ROLES = {
  user: {
    placement: 'end' as const,
    variant: 'filled' as const,
    shape: 'corner' as const,
    avatar: (
      <Avatar
        size={26}
        className="insight-avatar insight-avatar--user"
        icon={<UserOutlined />}
      />
    ),
    // 默认 filled 取的是 antd 的浅填充色，在白底上偏灰
    styles: { content: { background: '#eef2f7', color: 'var(--ink)' } },
  },
  assistant: {
    placement: 'start' as const,
    variant: 'borderless' as const,
    shape: 'default' as const,
    avatar: (
      <Avatar
        size={26}
        className="insight-avatar insight-avatar--ai"
        icon={<ThunderboltOutlined />}
      />
    ),
  },
};

export function InsightDrawer({ open, onClose, brand, period, onScopeChange }: Props) {
  const [input, setInput] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);

  const scope = useMemo(
    () => (brand && period ? { brand, from: period.from, to: period.to } : null),
    [brand, period?.from, period?.to],
  );

  const {
    messages,
    sessions,
    activeSessionId,
    status,
    error,
    loadingHistory,
    send,
    stop,
    reset,
    switchSession,
    clearError,
  } = useInsightChat(scope, open, { onScopeChange });

  const sending = status === 'sending';
  const empty = messages.length === 0 && !loadingHistory;

  const handleSubmit = (text: string): void => {
    if (!text.trim() || sending) return;
    setInput('');
    void send(text);
  };

  const handleCreate = (): void => {
    reset();
    setHistoryOpen(false);
  };

  const handleSelect = (id: string): void => {
    switchSession(id);
    setHistoryOpen(false);
  };

  const items = messages.map((message) => {
    const isAi = message.role === 'assistant';
    return {
      key: message.key,
      role: message.role,
      content: message.content,
      // 首字未到之前显示 loading，避免出现一个空白气泡
      loading: isAi && message.streaming && message.content.length === 0,
      ...(isAi
        ? {
            streaming: message.streaming,
            contentRender: (content: unknown) => (
              <InsightMarkdown
                content={String(content ?? '')}
                streaming={message.streaming}
              />
            ),
          }
        : {}),
    };
  });

  // 同一个列表要能同时渲染进侧栏和窄屏的历史抽屉，所以包成函数而不是复用同一个元素
  const renderSideList = () => (
    <SessionList
      items={sessions}
      activeId={activeSessionId}
      disabled={sending || loadingHistory}
      onSelect={handleSelect}
      onCreate={handleCreate}
    />
  );

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        placement="right"
        width={800}
        rootClassName="insight-drawer"
        title={
          <span className="insight-title">
            <ThunderboltOutlined className="insight-title__icon" />
            AI Insight
          </span>
        }
        extra={
          <span className="insight-actions">
            <Button
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => setHistoryOpen(true)}
            >
              历史
            </Button>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={handleCreate}
              disabled={sending}
            >
              新对话
            </Button>
          </span>
        }
        styles={{ body: { padding: 0 } }}
      >
        <div className="insight-panel">
          <aside className="insight-panel__side">{renderSideList()}</aside>

          <div className="insight-panel__main">
            <div className="insight__note">
              {scope
                ? `基于 ${scope.brand} 在 ${prettyDate(scope.from)} — ${prettyDate(scope.to)} 的看板数据作答，数字与页面上一致。`
                : '等待看板数据加载…'}
            </div>

            {error && (
              <div className="insight__alert">
                <Alert
                  type="warning"
                  showIcon
                  message={error}
                  closable
                  onClose={clearError}
                />
              </div>
            )}

            <div className="insight__thread">
              {empty ? (
                <div className="insight-welcome">
                  <h3 className="insight-welcome__title">问点什么？</h3>
                  <p className="insight-welcome__lede">
                    它会先找最弱的平台和主题，再看「提到了却没被推荐」的落差——
                    这两处才是能马上动手的地方。
                  </p>
                  <div className="insight-welcome__presets">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className="insight-preset"
                        onClick={() => handleSubmit(preset)}
                        disabled={!scope || sending}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <Bubble.List
                  className="insight__list"
                  items={items}
                  role={ROLES}
                  autoScroll
                />
              )}
            </div>

            <div className="insight__composer">
              <Sender
                value={input}
                onChange={setInput}
                onSubmit={handleSubmit}
                loading={sending}
                onCancel={stop}
                disabled={!scope || loadingHistory}
                placeholder="问数据里的任何一件事，例如：哪个主题最该补内容？"
                autoSize={{ minRows: 1, maxRows: 4 }}
              />
            </div>
          </div>
        </div>
      </Drawer>

      <Drawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        placement="left"
        width={288}
        rootClassName="insight-history"
        title="对话记录"
        styles={{ body: { padding: 0 } }}
      >
        {renderSideList()}
      </Drawer>
    </>
  );
}
