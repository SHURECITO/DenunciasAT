import Sidebar from '@/components/Sidebar';
import EstadisticasClient from './EstadisticasClient';

export default function EstadisticasPage() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar active="estadisticas" />
      <main className="flex flex-1 flex-col overflow-auto">
        <header className="border-b border-gray-200 bg-white px-8 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Estadísticas y reportes</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Panel operativo y análisis de impacto de la gestión del despacho
          </p>
        </header>
        <div className="flex-1 px-8 py-6">
          <EstadisticasClient />
        </div>
      </main>
    </div>
  );
}
