import type { ThemeConfig } from 'antd';

/**
 * antd 主题：把组件控件的观感对齐到「明亮报告」体系。
 * 强调色只给数据信号与主按钮，选中态用墨色，避免整页都是橙色。
 */
export const antdTheme: ThemeConfig = {
  token: {
    colorPrimary: '#f4511e',
    colorInfo: '#2563eb',
    colorSuccess: '#0d9488',
    colorWarning: '#d97706',
    colorError: '#e5484d',

    /* antd 会给 a 注入全局样式，默认取 colorLink（来自 colorInfo）——
       不覆盖的话正文链接会变成浏览器味的蓝色，和这套配色打架 */
    colorLink: '#0f172a',
    colorLinkHover: '#f4511e',
    colorLinkActive: '#d33c0c',

    colorText: '#0f172a',
    colorTextSecondary: '#5c6779',
    colorTextTertiary: '#94a0b2',
    colorTextPlaceholder: '#94a0b2',

    colorBorder: '#dfe4ec',
    colorBorderSecondary: '#eef1f6',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorFillQuaternary: '#f4f6f9',

    borderRadius: 8,
    borderRadiusLG: 10,
    controlHeight: 32,
    fontSize: 13,
    /* 报告类页面不需要控件动效：关掉后 Segmented 的滑块直接定位，
       也避免首屏/截图里滑块停在错误选项上 */
    // motion: false,
    fontFamily:
      '"PingFang SC", "Hiragino Sans GB", "Helvetica Neue", "Microsoft YaHei", system-ui, sans-serif',
    boxShadowSecondary: '0 8px 24px -8px rgba(15, 23, 42, 0.16)',
  },
  components: {
    Table: {
      headerBg: '#f7f9fc',
      headerColor: '#5c6779',
      headerSplitColor: 'transparent',
      borderColor: '#eef1f6',
      rowHoverBg: '#f7f9fc',
      cellPaddingBlock: 11,
      cellPaddingInline: 12,
      fontSize: 13,
    },
    Segmented: {
      trackBg: '#eef1f6',
      itemColor: '#5c6779',
      itemHoverColor: '#0f172a',
      itemSelectedBg: '#0f172a',
      itemSelectedColor: '#ffffff',
    },
    Select: {
      optionSelectedBg: '#fff1eb',
      optionSelectedColor: '#0f172a',
    },
    Input: {
      activeShadow: '0 0 0 3px rgba(244, 81, 30, 0.12)',
    },
    DatePicker: {
      activeShadow: '0 0 0 3px rgba(244, 81, 30, 0.12)',
      cellActiveWithRangeBg: '#ffe9e0',
    },
    Pagination: {
      itemActiveBg: '#ffffff',
    },
    Drawer: {
      paddingLG: 24,
    },
    Alert: {
      defaultPadding: '10px 14px',
    },
  },
};
