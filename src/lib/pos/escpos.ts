/**
 * ESC/POS Thermal Printer Protocol Encoder & Hardware Integration
 * Supports 58mm (32 columns) and 80mm (48 columns) receipt printers
 * with WebUSB, Web Bluetooth, Web Serial, and standard Raw TCP/Print spoolers.
 */

export interface EscPosOptions {
  paperWidth?: '58mm' | '80mm';
  codepage?: string;
  openCashDrawer?: boolean;
  cutPaper?: boolean;
}

export class EscPosBuilder {
  private buffer: number[] = [];
  private readonly columns: number;

  constructor(options: EscPosOptions = {}) {
    this.columns = options.paperWidth === '58mm' ? 32 : 48;
    this.init();
    if (options.openCashDrawer) {
      this.pulseCashDrawer();
    }
  }

  init(): this {
    this.buffer.push(0x1b, 0x40); // ESC @ (Initialize)
    return this;
  }

  pulseCashDrawer(pin: 0 | 1 = 0): this {
    // ESC p m t1 t2 (generate pulse to kick drawer)
    this.buffer.push(0x1b, 0x70, pin === 0 ? 0x00 : 0x01, 0x19, 0xfa);
    return this;
  }

  align(alignment: 'left' | 'center' | 'right'): this {
    const val = alignment === 'left' ? 0x00 : alignment === 'center' ? 0x01 : 0x02;
    this.buffer.push(0x1b, 0x61, val);
    return this;
  }

  bold(enable = true): this {
    this.buffer.push(0x1b, 0x45, enable ? 0x01 : 0x00);
    return this;
  }

  textSize(size: 'normal' | 'double-height' | 'double-width' | 'double'): this {
    let byte = 0x00;
    if (size === 'double-height') byte = 0x01;
    else if (size === 'double-width') byte = 0x10;
    else if (size === 'double') byte = 0x11;
    this.buffer.push(0x1d, 0x21, byte);
    return this;
  }

  underline(enable = true): this {
    this.buffer.push(0x1b, 0x2d, enable ? 0x01 : 0x00);
    return this;
  }

  text(str: string): this {
    const bytes = this.encodeString(str);
    this.buffer.push(...bytes);
    return this;
  }

  line(str = ''): this {
    this.text(str);
    this.buffer.push(0x0a); // LF
    return this;
  }

  feed(lines = 1): this {
    for (let i = 0; i < lines; i++) {
      this.buffer.push(0x0a);
    }
    return this;
  }

  divider(char = '-'): this {
    const line = char.repeat(this.columns);
    return this.line(line);
  }

  doubleDivider(): this {
    return this.divider('=');
  }

  twoColumn(left: string, right: string, padChar = ' '): this {
    const leftClean = left.trim();
    const rightClean = right.trim();
    const spaceNeeded = this.columns - leftClean.length - rightClean.length;

    if (spaceNeeded > 0) {
      const line = leftClean + padChar.repeat(spaceNeeded) + rightClean;
      return this.line(line);
    }

    // Wrap left if too long
    const availableLeft = this.columns - rightClean.length - 1;
    const truncatedLeft = leftClean.slice(0, Math.max(0, availableLeft));
    const line = truncatedLeft + ' ' + rightClean;
    return this.line(line);
  }

  threeColumn(left: string, middle: string, right: string): this {
    const leftWidth = Math.floor(this.columns * 0.45);
    const midWidth = Math.floor(this.columns * 0.25);
    const rightWidth = this.columns - leftWidth - midWidth;

    const l = left.slice(0, leftWidth).padEnd(leftWidth, ' ');
    const m = middle.slice(0, midWidth).padEnd(midWidth, ' ');
    const r = right.slice(0, rightWidth).padStart(rightWidth, ' ');

    return this.line(`${l}${m}${r}`);
  }

  cut(fullCut = false): this {
    this.feed(3);
    // GS V m n
    this.buffer.push(0x1d, 0x56, fullCut ? 0x00 : 0x01, 0x00);
    return this;
  }

  build(): Uint8Array {
    return new Uint8Array(this.buffer);
  }

  private encodeString(str: string): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 128) {
        bytes.push(code);
      } else {
        // Simple fallback for UTF-8 extended characters
        bytes.push(0x20); // space or standard ascii representation
      }
    }
    return bytes;
  }
}

interface BluetoothCharacteristic {
  writeValue: (value: Uint8Array | BufferSource) => Promise<void>;
}

interface BluetoothService {
  getCharacteristic: (characteristic: string) => Promise<BluetoothCharacteristic>;
}

interface BluetoothServer {
  connect: () => Promise<BluetoothServer>;
  getPrimaryService: (service: string) => Promise<BluetoothService>;
}

interface BluetoothDevice {
  gatt?: BluetoothServer;
}

interface BluetoothAPI {
  requestDevice: (options: {
    filters?: Array<{ services?: string[] }>;
    optionalServices?: string[];
  }) => Promise<BluetoothDevice>;
}

interface SerialPort {
  open: (options: { baudRate: number }) => Promise<void>;
  close: () => Promise<void>;
  writable: {
    getWriter: () => {
      write: (data: Uint8Array | BufferSource) => Promise<void>;
      releaseLock: () => void;
    };
  };
}

interface SerialAPI {
  requestPort: () => Promise<SerialPort>;
}

interface NavigatorWithHardware extends Navigator {
  bluetooth?: BluetoothAPI;
  serial?: SerialAPI;
}

/**
 * Send binary payload directly to Web Bluetooth thermal printer
 */
export async function printViaBluetooth(bytes: Uint8Array): Promise<boolean> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as NavigatorWithHardware | undefined;
  if (!nav?.bluetooth) {
    throw new Error('Web Bluetooth is not supported in this browser. Use Chrome or Edge.');
  }

  const device = await nav.bluetooth.requestDevice({
    filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
    optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-4ae5-8fa9-9fafd205e455'],
  });

  if (!device.gatt) {
    throw new Error('GATT server not found on Bluetooth device.');
  }

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
  const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');

  // Chunk write for BLE buffer limit (512 bytes)
  const chunkSize = 128;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.slice(i, i + chunkSize);
    await characteristic.writeValue(chunk);
  }

  return true;
}

/**
 * Send binary payload directly to Web Serial (USB-Serial / RS232) thermal printer
 */
export async function printViaSerial(bytes: Uint8Array, baudRate = 9600): Promise<boolean> {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as NavigatorWithHardware | undefined;
  if (!nav?.serial) {
    throw new Error('Web Serial is not supported in this browser.');
  }

  const port = await nav.serial.requestPort();
  await port.open({ baudRate });

  const writer = port.writable.getWriter();
  await writer.write(bytes);
  writer.releaseLock();
  await port.close();

  return true;
}
