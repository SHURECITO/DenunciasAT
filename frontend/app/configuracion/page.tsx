import Sidebar from '@/components/Sidebar';
import ConfiguracionClient from './ConfiguracionClient';

export default function ConfiguracionPage() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar active="configuracion" />
      <main className="flex flex-1 flex-col overflow-auto">
        <header className="border-b border-gray-200 bg-white px-8 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Configuración</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Estado de conexión WhatsApp y configuración del sistema
          </p>
        </header>
        <div className="flex-1 px-8 py-6">
          <ConfiguracionClient />
        </div>
      </main>
    </div>
  );
}
