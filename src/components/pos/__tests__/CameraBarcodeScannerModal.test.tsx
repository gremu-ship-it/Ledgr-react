// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@/i18n';
import { CameraBarcodeScannerModal } from '../CameraBarcodeScannerModal';

const originalDetector = Object.getOwnPropertyDescriptor(window, 'BarcodeDetector');
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

describe('CameraBarcodeScannerModal', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;
  let detect: ReturnType<typeof vi.fn>;
  let formats: readonly string[] | undefined;

  beforeEach(() => {
    formats = undefined;
    detect = vi.fn().mockResolvedValue([{ rawValue: '6901234567892' }]);
    class FakeBarcodeDetector {
      constructor(options: { formats?: readonly string[] }) {
        formats = options.formats;
      }

      detect = detect;
    }
    Object.defineProperty(window, 'BarcodeDetector', {
      configurable: true,
      value: FakeBarcodeDetector,
    });

    const track = { stop: vi.fn() };
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    if (originalDetector) Object.defineProperty(window, 'BarcodeDetector', originalDetector);
    else Reflect.deleteProperty(window, 'BarcodeDetector');
    if (originalMediaDevices) Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices);
    else Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('uses the rear camera and native BarcodeDetector at ~10 FPS, then pauses after a scan', async () => {
    const onScan = vi.fn();
    render(<CameraBarcodeScannerModal open onClose={vi.fn()} onScan={onScan} />);

    await waitFor(() => expect(screen.getByText('Point camera at item barcode')).toBeTruthy());
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    expect(formats).toEqual([
      'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code',
    ]);

    await waitFor(() => expect(onScan).toHaveBeenCalledWith('6901234567892'), { timeout: 1000 });
    expect(detect).toHaveBeenCalled();

    // The 1.5s cooldown stops one barcode from adding the same item repeatedly.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it('offers manual entry when BarcodeDetector is unavailable', async () => {
    Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: undefined });
    const onScan = vi.fn();
    render(<CameraBarcodeScannerModal open onClose={vi.fn()} onScan={onScan} />);

    expect(screen.getByText(/Barcode detection not supported on this browser/)).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Or enter barcode manually…'), {
      target: { value: 'SKU-123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
    expect(onScan).toHaveBeenCalledWith('SKU-123');
  });
});
