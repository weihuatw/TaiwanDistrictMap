import { startAdminApp } from './apps/admin/main';
import './ui/style.css';

const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
const app = startAdminApp(root);
import.meta.hot?.dispose(() => app.destroy());
