import '../../ui/style.css';
import './style.css';
import { startHousingApp } from './main';

const root=document.getElementById('app');
if(!root)throw new Error('Missing application root');
const app=startHousingApp(root);
import.meta.hot?.dispose(()=>app.destroy());
