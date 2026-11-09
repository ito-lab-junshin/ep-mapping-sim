import { Scene } from './three/Scene';
import { ControlPanel } from './ui/ControlPanel';
import { EgmPanel } from './ui/EgmPanel';
import './styles.css';

export default function App() {
  return (
    <div className="layout">
      <ControlPanel />
      <main className="view"><Scene /></main>
      <EgmPanel />
    </div>
  );
}
