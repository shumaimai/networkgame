import './i18n/runtime';
import '@fontsource/zen-maru-gothic/400.css';
import '@fontsource/zen-maru-gothic/500.css';
import '@fontsource/zen-maru-gothic/700.css';
import '@fontsource/zen-maru-gothic/900.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/700.css';
import './ui/style.css';
import { App } from './ui/app';

(window as any).app = new App();
