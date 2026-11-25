import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, Keyboard, ScanLine, X } from 'lucide-react';

const BARCODE_FORMATS = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'qr_code',
] as const;

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface BarcodeDetectorConstructor {
  new (options?: { formats?: readonly string[] }): BarcodeDetectorLike;
}

type BarcodeDetectorWindow = Window & { BarcodeDetector?: BarcodeDetectorConstructor };
type ScannerStatus = 'starting' | 'ready' | 'unsupported' | 'error';

interface CameraBarcodeScannerModalProps {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

/**
 * Web Standards-only camera scanner. No decode library, no audio files: the
 * browser's BarcodeDetector reads the video frames and an AudioContext
 * oscillator supplies the success beep. The keyboard-wedge input in the
 * product catalogue stays untouched for USB/Bluetooth scanners.
 */
export function CameraBarcodeScannerModal({ open, onClose, onScan }: CameraBarcodeScannerModalProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const onScanRef = useRef(onScan);
  const [manualBarcode, setManualBarcode] = useState('');
  const [status, setStatus] = useState<ScannerStatus>('starting');

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const playBeep = useCallback(() => {
    try {
      const AudioContextCtor = window.AudioContext
        ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;

      const context = audioContextRef.current ?? new AudioContextCtor();
      audioContextRef.current = context;
      if (context.state === 'suspended') void context.resume();

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(1900, context.currentTime);
      gain.gain.setValueAtTime(0.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.12);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
    } catch {
      // A blocked audio context must never stop a sale.
    }
  }, []);

  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    const detector = detectorRef.current;
    if (!video || !detector || pausedRef.current) return;

    try {
      const codes = await detector.detect(video);
      const barcode = codes[0]?.rawValue?.trim();
      if (!barcode || pausedRef.current) return;

      pausedRef.current = true;
      navigator.vibrate?.(100);
      playBeep();
      onScanRef.current(barcode);
      pauseTimeoutRef.current = setTimeout(() => {
        pausedRef.current = false;
        pauseTimeoutRef.current = null;
      }, 1500);
    } catch {
      // Transient decode errors are normal while the camera focuses.
    }
  }, [playBeep]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const video = videoRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset status when the modal opens
    setStatus('starting');
    const DetectorCtor = (window as BarcodeDetectorWindow).BarcodeDetector;

    if (!DetectorCtor || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unsupported');
      return;
    }

    async function startCamera() {
      try {
        const detector = new DetectorCtor!({ formats: BARCODE_FORMATS });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        detectorRef.current = detector;
        streamRef.current = stream;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        if (cancelled) return;

        setStatus('ready');
        intervalRef.current = setInterval(() => void scanFrame(), 100);
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (pauseTimeoutRef.current !== null) {
        clearTimeout(pauseTimeoutRef.current);
        pauseTimeoutRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      detectorRef.current = null;
      pausedRef.current = false;
      if (video) video.srcObject = null;
      if (audioContextRef.current) {
        void audioContextRef.current.close().catch(() => undefined);
        audioContextRef.current = null;
      }
    };
  }, [open, scanFrame]);

  const handleManualSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const barcode = manualBarcode.trim();
    if (!barcode) return;
    navigator.vibrate?.(100);
    playBeep();
    onScanRef.current(barcode);
    setManualBarcode('');
  };

  if (!open) return null;

  const statusMessage = status === 'unsupported'
    ? t('pos.cameraNotSupported')
    : status === 'error'
      ? t('pos.cameraUnavailable')
      : t('pos.pointCamera');

  return (
    <div
      className="fixed inset-0 z-60 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-barcode-scanner-title"
    >
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <Camera className="h-5 w-5 text-brand-600" />
            <h2 id="camera-barcode-scanner-title" className="text-sm font-black text-gray-900">
              {t('pos.cameraScannerTitle')}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('pos.closeCameraScanner')}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="relative overflow-hidden rounded-2xl bg-black">
            <video
              ref={videoRef}
              className="aspect-[4/3] w-full object-cover"
              autoPlay
              playsInline
              muted
            />
            {status === 'ready' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-32 w-64 rounded-2xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)] animate-pulse">
                  <span className="absolute -left-0.5 -top-0.5 h-5 w-5 rounded-tl-lg border-l-4 border-t-4 border-brand-400" />
                  <span className="absolute -right-0.5 -top-0.5 h-5 w-5 rounded-tr-lg border-r-4 border-t-4 border-brand-400" />
                  <span className="absolute -bottom-0.5 -left-0.5 h-5 w-5 rounded-bl-lg border-b-4 border-l-4 border-brand-400" />
                  <span className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-br-lg border-b-4 border-r-4 border-brand-400" />
                  <span
                    className="absolute left-4 right-4 top-1/2 h-0.5 bg-red-500/90 shadow-lg shadow-red-500"
                    style={{ animation: 'ledgr-reticle-sweep 2s ease-in-out infinite' }}
                  />
                </div>
              </div>
            )}
            {status !== 'ready' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/70">
                <ScanLine className="h-10 w-10" />
              </div>
            )}
          </div>

          <p className="text-center text-xs font-semibold text-gray-600" role="status">
            {statusMessage}
          </p>

          <form onSubmit={handleManualSubmit} className="space-y-2">
            <label htmlFor="manual-barcode-input" className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-gray-500">
              <Keyboard className="h-3.5 w-3.5" />
              {t('pos.manualBarcodeInput')}
            </label>
            <div className="flex gap-2">
              <input
                id="manual-barcode-input"
                type="text"
                inputMode="text"
                autoComplete="off"
                value={manualBarcode}
                onChange={(event) => setManualBarcode(event.target.value)}
                placeholder={t('pos.manualBarcodeInput')}
                className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-xs font-semibold focus:border-brand-500 focus:bg-white focus:outline-none"
              />
              <button
                type="submit"
                disabled={!manualBarcode.trim()}
                className="rounded-xl bg-brand-600 px-4 py-2.5 text-xs font-black text-white disabled:opacity-40"
              >
                {t('common.submit')}
              </button>
            </div>
          </form>
        </div>
      </div>
      <style>{`
        @keyframes ledgr-reticle-sweep {
          0%, 100% { transform: translateY(-48px); }
          50% { transform: translateY(48px); }
        }
      `}</style>
    </div>
  );
}

export default CameraBarcodeScannerModal;
