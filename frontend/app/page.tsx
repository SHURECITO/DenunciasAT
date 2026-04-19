import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import DenunciasLiveTable from '@/components/DenunciasLiveTable';
import { getDenuncias, type Denuncia, type DenunciaEstado } from '@/lib/api';

const FILTROS: { label: string; value: DenunciaEstado | undefined }[] = [
  { label: 'Todas', value: undefined },
  { label: 'Recibida', value: 'RECIBIDA' },
  { label: 'En gestión', value: 'EN_GESTION' },
  { label: 'Radicada', value: 'RADICADA' },
  { label: 'Con respuesta', value: 'CON_RESPUESTA' },
];

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
          {/* Filtros */}
          <div className="mb-5 flex flex-wrap gap-2">
            {FILTROS.map((f) => {
              const isActive = f.value === filtroEstado;
              const href = f.value ? `/?estado=${f.value}` : '/';
              return (
                <Link
                  key={f.label}
                  href={href}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-blue-800 text-white'
                      : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {f.label}
                </Link>
              );
            })}
          </div>

          <DenunciasLiveTable
            initialDenuncias={denuncias}
            fetchError={fetchError}
            filtroEstado={filtroEstado}
          />
        </div>
      </main>
    </div>
  );
}
