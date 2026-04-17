import Link from 'next/link';
import DenunciaEstadoBadge from '@/components/DenunciaEstadoBadge';
import Sidebar from '@/components/Sidebar';
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

          {fetchError && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
              {fetchError}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {denuncias.length === 0 && !fetchError ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <svg className="mb-3 h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                </svg>
                <p className="text-sm font-medium">No hay denuncias</p>
                <p className="text-xs mt-1">
                  {filtroEstado ? 'No hay denuncias con este estado.' : 'Aún no se han registrado denuncias.'}
                </p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-6 py-3 text-left">Radicado</th>
                    <th className="px-6 py-3 text-left">Ciudadano</th>
                    <th className="px-6 py-3 text-left">Dependencia</th>
                    <th className="px-6 py-3 text-left">Estado</th>
                    <th className="px-6 py-3 text-left">Doc.</th>
                    <th className="px-6 py-3 text-left">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                  {denuncias.map((d) => (
                    <tr key={d.id} className="transition-colors hover:bg-gray-50 cursor-pointer">
                      <td className="px-6 py-3 font-mono font-medium text-gray-900">
                        <Link href={`/denuncias/${d.id}`} className="hover:text-blue-600">
                          {d.radicado}
                        </Link>
                        {d.incompleta && (
                          <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                            Incompleta
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <Link href={`/denuncias/${d.id}`} className="block">
                          <div className="font-medium">{d.nombreCiudadano}</div>
                          <div className="text-xs text-gray-400">{d.cedula}</div>
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-gray-500">
                        {d.dependenciaAsignada ?? <span className="italic text-gray-300">Sin asignar</span>}
                      </td>
                      <td className="px-6 py-3">
                        <DenunciaEstadoBadge estado={d.estado} />
                      </td>
                      <td className="px-6 py-3 text-center text-base" title={
                        d.documentoGeneradoOk
                          ? 'Documento listo'
                          : d.documentoPendiente
                          ? 'Generando...'
                          : d.esEspecial
                          ? 'Caso especial'
                          : '—'
                      }>
                        {d.documentoGeneradoOk ? '📄' : d.documentoPendiente ? '⏳' : '—'}
                      </td>
                      <td className="px-6 py-3 text-gray-500">
                        {new Date(d.fechaCreacion).toLocaleDateString('es-CO', {
                          day: '2-digit',
                          month: 'short',
                          year: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {denuncias.length > 0 && (
            <p className="mt-3 text-right text-xs text-gray-400">
              {denuncias.length} denuncia{denuncias.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
