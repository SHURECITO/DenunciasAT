import Sidebar from '@/components/Sidebar';
import NuevaDenunciaForm from './NuevaDenunciaForm';

export default function NuevaDenunciaPage() {
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar active="nueva" />
      <main className="flex flex-1 flex-col overflow-auto">
        <header className="border-b border-gray-200 bg-white px-8 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Nueva denuncia manual</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Registrada directamente por el equipo del despacho
          </p>
        </header>
        <div className="flex-1 px-8 py-6">
          <NuevaDenunciaForm />
        </div>
      </main>
    </div>
  );
}
