'use client';

import { useState, useCallback } from 'react';
import DenunciasHeader from '@/components/DenunciasHeader';
import DenunciasLiveTable from '@/components/DenunciasLiveTable';
import { type Denuncia, type DenunciaEstado } from '@/lib/api';

interface Props {
  initialDenuncias: Denuncia[];
  fetchError: string;
  filtroEstado: DenunciaEstado | undefined;
}

export default function DenunciasPageClient({ initialDenuncias, fetchError, filtroEstado }: Props) {
  const [denuncias, setDenuncias] = useState(initialDenuncias);
  const [searchResults, setSearchResults] = useState<Denuncia[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(fetchError);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const res = await fetch(`/api/denuncias${filtroEstado ? `?estado=${filtroEstado}` : ''}`);
      if (!res.ok) throw new Error('Error al recargar');
      const data: Denuncia[] = await res.json();
      setDenuncias(data);
      setSearchResults(null);
    } catch {
      setError('No se pudo recargar las denuncias.');
    } finally {
      setRefreshing(false);
    }
  }, [filtroEstado]);

  const displayDenuncias = searchResults ?? denuncias;

  return (
    <>
      <DenunciasHeader
        filtroEstado={filtroEstado}
        onResults={setSearchResults}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />
      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
      <DenunciasLiveTable
        initialDenuncias={displayDenuncias}
        fetchError=""
        filtroEstado={filtroEstado}
      />
    </>
  );
}
