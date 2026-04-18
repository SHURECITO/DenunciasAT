'use client';

import { useState, useEffect } from 'react';
import { type Denuncia } from '@/lib/api';

interface DependenciaInfo {
  nombre: string;
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
  const [dependenciasDisponibles, setDependenciasDisponibles] = useState<DependenciaInfo[]>([]);
  const [search, setSearch] = useState('');
  
  const [dependenciasAsignadas, setDependenciasAsignadas] = useState<string[]>([]);
  const [descripcion, setDescripcion] = useState(denuncia.descripcion || '');
  const [ubicacion, setUbicacion] = useState(denuncia.ubicacion || '');
  const [barrio, setBarrio] = useState(denuncia.barrio || '');
  const [comuna, setComuna] = useState(denuncia.comuna || '');
  const [solicitudAdicional, setSolicitudAdicional] = useState((denuncia as any).solicitudAdicional || '');
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
    ? dependenciasDisponibles.filter(d => d.nombre.toLowerCase().includes(search.toLowerCase()) && !dependenciasAsignadas.includes(d.nombre))
    : dependenciasDisponibles.filter(d => !dependenciasAsignadas.includes(d.nombre)).slice(0, 5);

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
          regenerarDocumento
        })
      });
      if (!res.ok) {
        const d = await res.json().catch(()=>({}));
        throw new Error(d.message || 'Error al actualizar denuncia');
      }
      const data = await res.json();
      onSaved(data, regenerarDocumento);
    } catch(err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function addDependencia(dep: string) {
    if (!dependenciasAsignadas.includes(dep)) {
      setDependenciasAsignadas([...dependenciasAsignadas, dep]);
      setSearch('');
    }
  }
  function removeDependencia(dep: string) {
    setDependenciasAsignadas(dependenciasAsignadas.filter(d => d !== dep));
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
        
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">{error}</div>}
          
          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Dependencias asignadas</h3>
            <div className="flex flex-wrap gap-2 mb-3">
              {dependenciasAsignadas.map(dep => (
                <span key={dep} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-700 text-sm font-medium border border-blue-100 group">
                  {dep}
                  <button onClick={() => removeDependencia(dep)} className="w-4 h-4 rounded-full hover:bg-blue-200 flex items-center justify-center text-blue-500 hover:text-blue-700 transition-colors">
                    ×
                  </button>
                </span>
              ))}
              {dependenciasAsignadas.length === 0 && (
                <span className="text-sm text-gray-400 italic py-1.5">Ninguna dependencia asignada</span>
              )}
            </div>
            
            <div className="relative">
              <input 
                type="text" 
                placeholder="Buscar y seleccionar dependencia..." 
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-4 py-2.5 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {search.trim().length > 0 && dependenciasFiltradas.length > 0 && (
                <ul className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-auto py-1 text-sm">
                  {dependenciasFiltradas.map(d => (
                    <li 
                      key={d.nombre} 
                      onClick={() => addDependencia(d.nombre)}
                      className="px-4 py-2 hover:bg-blue-50 cursor-pointer flex flex-col group transition-colors"
                    >
                      <span className="font-medium text-gray-900 group-hover:text-blue-700">{d.nombre}</span>
                      <span className="text-xs text-gray-500 group-hover:text-blue-600/80">{d.cargoTitular}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Datos de la denuncia (opcionales)</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                <textarea 
                  value={descripcion} 
                  onChange={e => setDescripcion(e.target.value)} 
                  rows={4} 
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Ubicación</label>
                  <input type="text" value={ubicacion} onChange={e => setUbicacion(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Barrio</label>
                  <input type="text" value={barrio} onChange={e => setBarrio(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Comuna</label>
                  <input type="text" value={comuna} onChange={e => setComuna(e.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"/>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Solicitud Adicional</label>
                <textarea 
                  value={solicitudAdicional} 
                  onChange={e => setSolicitudAdicional(e.target.value)} 
                  rows={2} 
                  placeholder="Información extra que el ciudadano solicitó explícitamente..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>
          </section>

          <section className="bg-blue-50/50 rounded-lg p-4 border border-blue-100">
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
