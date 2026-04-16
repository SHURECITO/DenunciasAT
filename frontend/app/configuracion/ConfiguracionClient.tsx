'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type WhatsappEstado = 'open' | 'close' | 'connecting';

interface EstadoResponse {
  estado: WhatsappEstado;
  qr?: string;
}

interface QrResponse {
  qr?: string;
}

export default function ConfiguracionClient() {
  const [estado, setEstado] = useState<WhatsappEstado | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [reconectando, setReconectando] = useState(false);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEstado = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/estado');
      const data = (await res.json()) as EstadoResponse;
      setEstado(data.estado);
    } catch {
      setEstado('close');
    }
  }, []);

  const fetchQr = useCallback(async () => {
    try {
      const res = await fetch('/api/whatsapp/qr');
      const data = (await res.json()) as QrResponse;
      setQr(data.qr ?? null);
    } catch {
      setQr(null);
    }
  }, []);

  // Polling de estado cada 5 segundos
  useEffect(() => {
    fetchEstado();
    const interval = setInterval(fetchEstado, 5000);
    return () => clearInterval(interval);
  }, [fetchEstado]);

  // Cuando no está conectado: cargar QR y refrescarlo cada 30 segundos
  useEffect(() => {
    if (estado === 'open') {
      setQr(null);
      if (qrTimerRef.current) clearInterval(qrTimerRef.current);
      return;
    }
    if (estado === 'close' || estado === 'connecting') {
      fetchQr();
      qrTimerRef.current = setInterval(fetchQr, 30000);
    }
    return () => {
      if (qrTimerRef.current) clearInterval(qrTimerRef.current);
    };
  }, [estado, fetchQr]);

  const handleReconectar = async () => {
    setReconectando(true);
    try {
      await fetch('/api/whatsapp/reconectar', { method: 'POST' });
      setEstado('connecting');
      setQr(null);
      await fetchQr();
    } finally {
      setReconectando(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Estado de conexión */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          Estado de WhatsApp
        </h2>

        <div className="flex items-center gap-3">
          {estado === null ? (
            <span className="text-sm text-gray-400">Verificando...</span>
          ) : estado === 'open' ? (
            <>
              <span className="h-3 w-3 rounded-full bg-green-500 shadow-sm shadow-green-300" />
              <span className="text-sm font-medium text-green-700">
                WhatsApp conectado
              </span>
            </>
          ) : estado === 'connecting' ? (
            <>
              <span className="h-3 w-3 rounded-full bg-yellow-400 animate-pulse" />
              <span className="text-sm font-medium text-yellow-700">
                Conectando...
              </span>
            </>
          ) : (
            <>
              <span className="h-3 w-3 rounded-full bg-red-500" />
              <span className="text-sm font-medium text-red-700">
                WhatsApp desconectado
              </span>
            </>
          )}

          <button
            onClick={handleReconectar}
            disabled={reconectando}
            className="ml-auto rounded-lg border border-gray-200 bg-white px-4 py-1.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {reconectando ? 'Reconectando...' : 'Reconectar'}
          </button>
        </div>
      </div>

      {/* QR — solo cuando no está conectado */}
      {estado !== 'open' && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h2 className="mb-1 text-base font-semibold text-gray-900">
            Escanear código QR
          </h2>
          <p className="mb-4 text-sm text-gray-500">
            Abre WhatsApp en tu teléfono &rarr; Dispositivos vinculados &rarr; Vincular dispositivo
          </p>

          {qr ? (
            <div className="flex flex-col items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qr.startsWith('data:') ? qr : `data:image/png;base64,${qr}`}
                alt="Código QR de WhatsApp"
                className="h-56 w-56 rounded-lg border border-gray-200 p-1"
              />
              <p className="text-xs text-gray-400">
                El código QR se renueva automáticamente cada 30 segundos
              </p>
            </div>
          ) : (
            <div className="flex h-56 w-56 items-center justify-center rounded-lg border border-dashed border-gray-300 bg-gray-50">
              <span className="text-sm text-gray-400">Cargando QR...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
