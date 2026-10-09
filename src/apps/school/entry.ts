import '../../ui/style.css';
import './style.css';
import { startSchoolApp } from './main';
const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
const app = startSchoolApp(root);
import.meta.hot?.dispose(() => app.destroy());
