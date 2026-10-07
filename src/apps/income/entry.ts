import '../../ui/style.css';
import './style.css';
import { startIncomeApp } from './main';

const root = document.getElementById('app');
if (!root) throw new Error('Missing application root');
const app = startIncomeApp(root);
import.meta.hot?.dispose(() => app.destroy());
