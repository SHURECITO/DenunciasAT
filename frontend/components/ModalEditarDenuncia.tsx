'use client';

import { useState, useEffect } from 'react';
import { type Denuncia } from '@/lib/api';

interface DependenciaInfo {
  nombre: string;
  nombreTitular: string;
  cargoTitular: string;
  nivel: string;
  tipo: string;
}

interface Props {
  denuncia: Denuncia;
  onClose: () => void;
  onSaved: (denunciaActualizada: Denuncia, regenerando: boolean) => void;
}

export default function ModalEditarDenuncia({ denuncia, onClose, onSaved }: Props) {
  const [activeTab, setActiveTab] = useState<'denunciante' | 'denuncia'>('denuncia');
  const [dependenciasDisponibles, setDependenciasDisponibles] = useState<DependenciaInfo[]>([]);
  const [search, setSearch] = useState('');
  
  const [dependenciasAsignadas, setDependenciasAsignadas] = useState<string[]>([]);
  const [descripcion, setDescripcion] = useState(denuncia.descripcion || '');
  const [ubicacion, setUbicacion] = useState(denuncia.ubicacion || '');
  const [barrio, setBarrio] = useState(denuncia.barrio || '');
  const [comuna, setComuna] = useState(denuncia.comuna || '');
  const [solicitudAdicional, setSolicitudAdicional] = useState(denuncia.solicitudAdicional ?? '');
  
  const [nombreCiudadano, setNombreCiudadano] = useState(denuncia.nombreCiudadano || '');
  const [cedula, setCedula] = useState(denuncia.cedula || '');
  const [telefono, setTelefono] = useState(denuncia.telefono || '');

  const [regenerarDocumento, setRegenerarDocumento] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  useEffect(() => {
    if (denuncia.dependenciaAsignada) {
      setDependenciasAsignadas(denuncia.dependenciaAsignada.split(/[,;]/).map(d => d.trim()).filter(Boolean));
    }
    fetch('/api/dependencias')
      .then(r => r.json())
      .then(data => setDependenciasDisponibles(Array.isArray(data) ? data : []))
      .catch(console.error);
  }, [denuncia.dependenciaAsignada]);

  const [initialDeps] = useState(denuncia.dependenciaAsignada || '');
  useEffect(() => {
    const depsStr = dependenciasAsignadas.join(', ');
    const initDepsStr = initialDeps.split(/[,;]/).map(d => d.trim()).filter(Boolean).join(', ');
    const isNewDeps = depsStr !== initDepsStr;
    const isNewDesc = descripcion !== denuncia.descripcion;
    setRegenerarDocumento(isNewDeps || isNewDesc);
  }, [dependenciasAsignadas, descripcion, denuncia.descripcion, initialDeps]);

  const dependenciasFiltradas = search.trim().length > 0
    ? dependenciasDisponibles.filter(d => d.nombre.toLowerCase().includes(search.toLowerCase()))
    : dependenciasDisponibles;

  async function handleSave() {
    if (dependenciasAsignadas.length === 0) {
      setError('Debes asignar al menos una dependencia.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/denuncias/${denuncia.id}/editar`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dependenciasAsignadas,
          descripcion,
          ubicacion,
          barrio,
          comuna,
          solicitudAdicional,
          nombreCiudadano,
          cedula,
          telefono,
          regenerarDocumento
        })
      });
      if (!res.ok) {
        const d = await res.json().catch(()=>({}));
        throw new Error(d.message || 'Error al actualizar denuncia');
      }
      const data = await res.json();
      onSaved(data, regenerarDocumento);
    } catch(err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Ocurrió un error inesperado.');
      }
    } finally {
      setLoading(false);
    }
  }

  function toggleDependencia(dep: string) {
    if (dependenciasAsignadas.includes(dep)) {
      setDependenciasAsignadas(dependenciasAsignadas.filter(d => d !== dep));
    } else {
      setDependenciasAsignadas([...dependenciasAsignadas, dep]);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h2 className="text-xl font-semibold text-gray-900">Editar denuncia {denuncia.radicado}</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200">
          <button 
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'denuncia' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('denuncia')}
          >
            Detalles Denuncia
          </button>
          <button 
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'denunciante' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
            onClick={() => setActiveTab('denunciante')}
          >
            Datos Ciudadano
          </button>
        </div>
        
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">{error}</div>}
          
          {activeTab === 'denuncia' && (
            <>
              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Dependencias asignadas</h3>
                <div className="border border-gray-200 rounded-lg p-2 bg-gray-50 h-52 flex flex-col">
                  <input 
                    type="text" 
                    placeholder="Filtrar dependencias..." 
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="w-full rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none mb-3 bg-white"
                  />
                  <div className="overflow-y-auto flex-1 space-y-2 pr-2">
                    {dependenciasFiltradas.map(d => (
                      <label key={d.nombre} className="flex items-start gap-3 p-2 rounded hover:bg-gray-100 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={dependenciasAsignadas.includes(d.nombre)}
                          onChange={() => toggleDependencia(d.nombre)}
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 bg-white"
                        />
                        <div className="flex flex-col">
                          <span className={`text-sm font-medium ${dependenciasAsignadas.includes(d.nombre) ? 'text-blue-900' : 'text-gray-900'}`}>{d.nombre}</span>
                          <span className="text-xs text-gray-500">{d.nombreTitular}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Datos del lugar</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación / Dirección</label>
                    <input type="text" value={ubicacion} onChange={e => setUbicacion(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"/>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Barrio</label>
                    <input type="text" value={barrio} onChange={e => setBarrio(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"/>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Comuna</label>
                    <input type="text" value={comuna} onChange={e => setComuna(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"/>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Descripción de los hechos</h3>
                <div className="space-y-4">
                  <div>
                    <textarea 
                      value={descripcion} 
                      onChange={e => setDescripcion(e.target.value)} 
                      rows={5} 
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Solicitud Adicional (Opcional)</label>
                    <textarea 
                      value={solicitudAdicional} 
                      onChange={e => setSolicitudAdicional(e.target.value)} 
                      rows={2} 
                      placeholder="Información extra que el ciudadano solicitó explícitamente..."
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none bg-white placeholder-gray-400"
                    />
                  </div>
                </div>
              </section>

            </>
          )}

          {activeTab === 'denunciante' && (
            <section className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nombre Ciudadano</label>
                <input 
                  type="text" 
                  value={nombreCiudadano} 
                  onChange={e => setNombreCiudadano(e.target.value)} 
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Cédula</label>
                <input 
                  type="text" 
                  value={cedula} 
                  onChange={e => setCedula(e.target.value)} 
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Teléfono</label>
                <input 
                  type="text" 
                  value={telefono} 
                  onChange={e => setTelefono(e.target.value)} 
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 bg-white"
                />
              </div>
            </section>
          )}

          <section className="bg-blue-50/50 rounded-lg p-4 border border-blue-100 mt-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Re-generar documento</h3>
            <label className="flex items-center gap-3">
              <input type="checkbox" checked={regenerarDocumento} onChange={e => setRegenerarDocumento(e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
              <span className="text-sm font-medium text-gray-800">Regenerar el documento con los cambios</span>
            </label>
            <p className="mt-2 text-xs text-gray-500 ml-7 leading-relaxed">
              La IA actualizará la sección HECHOS y el ASUNTO con las nuevas dependencias y descripción.
            </p>
          </section>
        </div>
        
        <div className="p-6 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
          <button onClick={onClose} disabled={loading} className="px-5 py-2.5 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={loading} className="px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {loading ? 'Guardando...' : 'Guardar cambios'}
          </button>
        </div>
      </div>
    </div>
  );
}
