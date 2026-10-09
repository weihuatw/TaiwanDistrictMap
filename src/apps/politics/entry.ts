import '../../ui/style.css';
import './style.css';
import { startPoliticsApp } from './main';
const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
const app = startPoliticsApp(root);
import.meta.hot?.dispose(() => app.destroy());
