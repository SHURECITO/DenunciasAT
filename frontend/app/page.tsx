import Sidebar from '@/components/Sidebar';
import DenunciasPageClient from '@/components/DenunciasPageClient';
import { getDenuncias, type Denuncia, type DenunciaEstado } from '@/lib/api';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { estado?: string };
}) {
  const filtroEstado = searchParams.estado as DenunciaEstado | undefined;
  let denuncias: Denuncia[] = [];
  let fetchError = '';
  try {
    denuncias = await getDenuncias(filtroEstado);
  } catch {
    fetchError = 'No se pudo cargar las denuncias. Verifica que el servidor esté activo.';
  }
  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar active="denuncias" />
      <main className="flex flex-1 flex-col overflow-auto">
        <header className="border-b border-gray-200 bg-white px-8 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Gestión de Denuncias</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Concejo de Medellín — Despacho Concejal Andrés Tobón
          </p>
        </header>
        <div className="flex-1 px-8 py-6">
          <DenunciasPageClient
            initialDenuncias={denuncias}
            fetchError={fetchError}
            filtroEstado={filtroEstado}
          />
        </div>
      </main>
    </div>
  );
}
