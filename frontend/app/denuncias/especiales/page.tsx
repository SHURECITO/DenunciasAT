import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import DenunciaEstadoBadge from '@/components/DenunciaEstadoBadge';
import { getDenunciasEspeciales, type Denuncia } from '@/lib/api';

export default async function EspecialesPage() {
  let denuncias: Denuncia[] = [];
  let fetchError = '';

  try {
    denuncias = await getDenunciasEspeciales();
  } catch {
    fetchError = 'No se pudo cargar las denuncias especiales.';
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar active="especiales" />

      <main className="flex flex-1 flex-col overflow-auto">
        <header className="border-b border-gray-200 bg-white px-8 py-5">
          <h1 className="text-xl font-semibold text-gray-900">Denuncias especiales</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Casos marcados como especiales — seguimiento prioritario
          </p>
        </header>

        <div className="flex-1 px-8 py-6">
          {fetchError && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
              {fetchError}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {denuncias.length === 0 && !fetchError ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <svg className="mb-3 h-10 w-10" fill="none" viewBox="0 0 24 24" strokeWidth={1.2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 0 1 1.04 0l2.125 5.111a.563.563 0 0 0 .475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 0 0-.182.557l1.285 5.385a.562.562 0 0 1-.84.61l-4.725-2.885a.562.562 0 0 0-.586 0L6.982 20.54a.562.562 0 0 1-.84-.61l1.285-5.386a.562.562 0 0 0-.182-.557l-4.204-3.602a.562.562 0 0 1 .321-.988l5.518-.442a.563.563 0 0 0 .475-.345L11.48 3.5Z" />
                </svg>
                <p className="text-sm font-medium">No hay denuncias especiales</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-100">
                <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-6 py-3 text-left">Radicado</th>
                    <th className="px-6 py-3 text-left">Ciudadano</th>
                    <th className="px-6 py-3 text-left">Dependencia</th>
                    <th className="px-6 py-3 text-left">Estado</th>
                    <th className="px-6 py-3 text-left">Fecha</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-sm text-gray-700">
                  {denuncias.map((d) => (
                    <tr key={d.id} className="transition-colors hover:bg-amber-50 cursor-pointer">
                      <td className="px-6 py-3 font-mono font-medium text-gray-900">
                        <Link href={`/denuncias/${d.id}`} className="hover:text-blue-600">
                          {d.radicado}
                        </Link>
                      </td>
                      <td className="px-6 py-3">
                        <Link href={`/denuncias/${d.id}`} className="block">
                          <div className="font-medium">{d.nombreCiudadano}</div>
                          <div className="text-xs text-gray-400">{d.cedula}</div>
                        </Link>
                      </td>
                      <td className="px-6 py-3 text-gray-500">
                        {d.dependenciaAsignada ?? (
                          <span className="italic text-gray-300">Sin asignar</span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <DenunciaEstadoBadge estado={d.estado} />
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
              {denuncias.length} denuncia{denuncias.length !== 1 ? 's' : ''} especial{denuncias.length !== 1 ? 'es' : ''}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
