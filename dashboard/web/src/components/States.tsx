import { Alert, Button } from 'antd';

interface NoticeProps {
  title: string;
  message: string;
  onRetry: () => void;
}

export function ErrorNotice({ title, message, onRetry }: NoticeProps) {
  return (
    <Alert
      type="error"
      showIcon
      message={title}
      description={<span className="font-mono text-[11px]">{message}</span>}
      action={
        <Button size="small" onClick={onRetry}>
          重新加载
        </Button>
      }
    />
  );
}

export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div aria-hidden="true" style={{ height, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="sk sk--line" style={{ height: 10, width: '30%' }} />
      <div className="sk" style={{ flex: 1 }} />
    </div>
  );
}

export function ChartEmpty({ hint }: { hint: string }) {
  return (
    <div className="empty" style={{ padding: '56px 0' }}>
      <strong>这个区间没有数据</strong>
      {hint}
    </div>
  );
}
