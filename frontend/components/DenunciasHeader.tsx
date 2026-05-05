'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { type Denuncia, type DenunciaEstado } from '@/lib/api';

const FILTROS: { label: string; value: DenunciaEstado | undefined }[] = [
  { label: 'Todas', value: undefined },
  { label: 'Recibida', value: 'RECIBIDA' },
  { label: 'En gestión', value: 'EN_GESTION' },
  { label: 'Radicada', value: 'RADICADA' },
  { label: 'Con respuesta', value: 'CON_RESPUESTA' },
];

interface Props {
  filtroEstado: DenunciaEstado | undefined;
  onResults: (denuncias: Denuncia[] | null) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

export default function DenunciasHeader({ filtroEstado, onResults, onRefresh, refreshing }: Props) {
  const [busqueda, setBusqueda] = useState('');
  const [buscando, setBuscando] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buscar = useCallback(async (termino: string, estado?: string) => {
    if (!termino.trim()) {
      onResults(null); // null = mostrar lista original
      return;
    }
    setBuscando(true);
    try {
      const params = new URLSearchParams({ q: termino });
      if (estado) params.set('estado', estado);
      const res = await fetch(`/api/denuncias/buscar?${params}`);
      if (!res.ok) return;
      const data: Denuncia[] = await res.json();
      onResults(data);
    } catch {
      // silencioso
    } finally {
      setBuscando(false);
    }
  }, [onResults]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setBusqueda(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      buscar(val, filtroEstado);
    }, 300);
  }

  return (
    <div className="mb-5 flex flex-col gap-3">
      {/* Buscador */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-md">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">🔍</span>
          <input
            type="text"
            value={busqueda}
            onChange={handleChange}
            placeholder="Buscar por nombre, cédula, radicado, dependencia..."
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {buscando && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
              Buscando...
            </span>
          )}
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          title="Recargar denuncias"
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
          {refreshing ? 'Recargando...' : 'Recargar'}
        </button>
      </div>
      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
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
    </div>
  );
}
