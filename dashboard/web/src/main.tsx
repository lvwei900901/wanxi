import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import App from './App';
import { antdTheme } from './theme';
import './styles/index.css';

dayjs.locale('zh-cn');

const container = document.getElementById('root');
if (!container) throw new Error('#root 未找到');

createRoot(container).render(
  <StrictMode>
    <ConfigProvider locale={zhCN} theme={antdTheme}>
      <App />
    </ConfigProvider>
  </StrictMode>,
);
