import { XMarkdown } from '@ant-design/x-markdown';
import '@ant-design/x-markdown/dist/x-markdown.css';

interface Props {
  content: string;
  /** 正在流式接收：未闭合的 Markdown 先缓冲，避免半截链接/表格闪一下 */
  streaming?: boolean;
}

/**
 * 模型输出的渲染层。
 *
 * 标题层级不在组件里改，统一交给 app.css 的 `.insight-md h1/h2` ——
 * 模型经常从 `#` 开始写，放进抽屉会顶得比抽屉标题还大。
 */
export function InsightMarkdown({ content, streaming = false }: Props) {
  return (
    <XMarkdown
      className="insight-md"
      content={content}
      openLinksInNewTab
      escapeRawHtml
      streaming={{
        hasNextChunk: streaming,
        // 只在流式时开淡入动画；历史消息直接渲染，避免一屏文字同时闪烁
        enableAnimation: streaming,
        tail: streaming ? { content: '▋' } : false,
      }}
    />
  );
}
