/**
 * QR Code generator library (TypeScript)
 *
 * Core mathematical and Reed-Solomon encoding implementation based on
 * Project Nayuki's ISO/IEC 18004 compliant QR Code generator.
 * Open source under MIT License.
 *
 * Modern ES Module implementation compatible with Node 22+ type-stripping,
 * Vite 8, and modern browser standards. Zero external dependencies.
 */

type int = number;
type byte = number;

/**
 * Error correction levels: Low (7%), Medium (15%), Quartile (25%), High (30%).
 */
export class QrEcc {
  public static readonly LOW = new QrEcc(0, 1);
  public static readonly MEDIUM = new QrEcc(1, 0);
  public static readonly QUARTILE = new QrEcc(2, 3);
  public static readonly HIGH = new QrEcc(3, 2);

  public readonly ordinal: int;
  public readonly formatBits: int;

  private constructor(ordinal: int, formatBits: int) {
    this.ordinal = ordinal;
    this.formatBits = formatBits;
  }
}

/**
 * Mode of a QR Code segment: Numeric, Alphanumeric, Byte, Kanji, ECI.
 */
export class QrMode {
  public static readonly NUMERIC = new QrMode(0x1, [10, 12, 14]);
  public static readonly ALPHANUMERIC = new QrMode(0x2, [9, 11, 13]);
  public static readonly BYTE = new QrMode(0x4, [8, 16, 16]);
  public static readonly KANJI = new QrMode(0x8, [8, 10, 12]);
  public static readonly ECI = new QrMode(0x7, [0, 0, 0]);

  public readonly modeBits: int;
  private readonly numBitsCharCount: [int, int, int];

  private constructor(modeBits: int, numBitsCharCount: [int, int, int]) {
    this.modeBits = modeBits;
    this.numBitsCharCount = numBitsCharCount;
  }

  public numCharCountBits(ver: int): int {
    return this.numBitsCharCount[Math.floor((ver + 7) / 17)]!;
  }
}

/**
 * Represents a segment of data in a QR Code symbol (e.g. byte mode).
 */
export class QrSegment {
  public static makeBytes(data: Readonly<Array<byte>>): QrSegment {
    const bb: Array<int> = [];
    for (const b of data) {
      appendBits(b, 8, bb);
    }
    return new QrSegment(QrMode.BYTE, data.length, bb);
  }

  public static makeSegments(text: string): Array<QrSegment> {
    return [QrSegment.makeBytes(toUtf8ByteArray(text))];
  }

  public static getTotalBits(segs: Readonly<Array<QrSegment>>, version: int): int {
    let result: int = 0;
    for (const seg of segs) {
      const ccbits: int = seg.mode.numCharCountBits(version);
      if (seg.numChars >= 1 << ccbits) {
        return Infinity;
      }
      result += 4 + ccbits + seg.bitData.length;
    }
    return result;
  }

  public readonly mode: QrMode;
  public readonly numChars: int;
  private readonly bitData: Array<int>;

  public constructor(mode: QrMode, numChars: int, bitData: Array<int>) {
    if (numChars < 0) {
      throw new RangeError('Invalid number of characters');
    }
    this.mode = mode;
    this.numChars = numChars;
    this.bitData = bitData;
  }

  public getData(): Array<int> {
    return this.bitData.slice();
  }
}

/**
 * Represents an immutable QR Code 2D symbol with modules, error correction, and masking.
 */
export class QrCode {
  public static readonly MIN_VERSION: int = 1;
  public static readonly MAX_VERSION: int = 40;

  /**
   * Creates a QR Code symbol representing the given UTF-8 text string at the requested
   * error correction level. Automatically selects the smallest version that fits the data.
   */
  public static encodeText(text: string, ecl: QrEcc): QrCode {
    const segs: Array<QrSegment> = QrSegment.makeSegments(text);
    return QrCode.encodeSegments(segs, ecl);
  }

  /**
   * Creates a QR Code symbol representing the given binary data at the requested
   * error correction level.
   */
  public static encodeBinary(data: Readonly<Array<byte>>, ecl: QrEcc): QrCode {
    const seg: QrSegment = QrSegment.makeBytes(data);
    return QrCode.encodeSegments([seg], ecl);
  }

  /**
   * Encodes a list of segments into a QR Code with automatic version and mask selection.
   */
  public static encodeSegments(
    segs: Readonly<Array<QrSegment>>,
    ecl: QrEcc,
    minVersion: int = 1,
    maxVersion: int = 40,
    mask: int = -1,
    boostEcl: boolean = true,
  ): QrCode {
    if (
      !(
        QrCode.MIN_VERSION <= minVersion &&
        minVersion <= maxVersion &&
        maxVersion <= QrCode.MAX_VERSION
      ) ||
      mask < -1 ||
      mask > 7
    ) {
      throw new RangeError('Invalid version or mask parameter');
    }

    // Find the minimal version number that can fit all the segments
    let version: int;
    let dataUsedBits: int;
    for (version = minVersion; ; version++) {
      const dataCapacityBits: int = QrCode.getNumDataCodewords(version, ecl) * 8;
      const usedBits: int = QrSegment.getTotalBits(segs, version);
      if (usedBits <= dataCapacityBits) {
        dataUsedBits = usedBits;
        break;
      }
      if (version >= maxVersion) {
        throw new RangeError('Data too long to fit into QR code');
      }
    }

    // Increase the error correction level if data still fits in the chosen version
    if (boostEcl) {
      for (const newEcl of [QrEcc.MEDIUM, QrEcc.QUARTILE, QrEcc.HIGH]) {
        if (dataUsedBits <= QrCode.getNumDataCodewords(version, newEcl) * 8) {
          ecl = newEcl;
        }
      }
    }

    // Concatenate all segments into a single bit buffer
    const bb: Array<int> = [];
    for (const seg of segs) {
      appendBits(seg.mode.modeBits, 4, bb);
      appendBits(seg.numChars, seg.mode.numCharCountBits(version), bb);
      for (const bit of seg.getData()) {
        bb.push(bit);
      }
    }
    if (bb.length !== dataUsedBits) {
      throw new Error('Assertion error');
    }

    // Add terminator bits and pad up to a full byte
    const dataCapacityBits: int = QrCode.getNumDataCodewords(version, ecl) * 8;
    if (bb.length > dataCapacityBits) {
      throw new Error('Assertion error');
    }
    appendBits(0, Math.min(4, dataCapacityBits - bb.length), bb);
    appendBits(0, (8 - (bb.length % 8)) % 8, bb);
    if (bb.length % 8 !== 0) {
      throw new Error('Assertion error');
    }

    // Pad with alternating bytes until data capacity is reached
    for (let padByte = 0xec; bb.length < dataCapacityBits; padByte ^= 0xec ^ 0x11) {
      appendBits(padByte, 8, bb);
    }

    // Pack bits into bytes in big endian
    const dataCodewords: Array<byte> = [];
    while (dataCodewords.length * 8 < bb.length) {
      dataCodewords.push(0);
    }
    bb.forEach((b: int, i: int) => {
      dataCodewords[i >>> 3]! |= b << (7 - (i & 7));
    });

    // Construct QrCode instance with dummy mask, then select best mask
    return new QrCode(version, ecl, dataCodewords, mask);
  }

  public readonly version: int;
  public readonly errorCorrectionLevel: QrEcc;
  public readonly size: int;
  public readonly mask: int;
  private readonly modules: Array<Array<boolean>> = [];
  private readonly isFunction: Array<Array<boolean>> = [];

  public constructor(
    version: int,
    errorCorrectionLevel: QrEcc,
    dataCodewords: Readonly<Array<byte>>,
    msk: int,
  ) {
    if (version < QrCode.MIN_VERSION || version > QrCode.MAX_VERSION) {
      throw new RangeError('Version out of range');
    }
    if (msk < -1 || msk > 7) {
      throw new RangeError('Mask value out of range');
    }
    this.version = version;
    this.errorCorrectionLevel = errorCorrectionLevel;
    this.size = version * 4 + 17;

    // Initialize 2D grid
    const row: Array<boolean> = [];
    for (let i = 0; i < this.size; i++) {
      row.push(false);
    }
    for (let i = 0; i < this.size; i++) {
      this.modules.push(row.slice());
      this.isFunction.push(row.slice());
    }

    // Draw function patterns
    this.drawFunctionPatterns();
    const allCodewords: Array<byte> = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);

    // Handle mask pattern
    if (msk === -1) {
      let minPenalty: int = 1_000_000_000;
      let bestMask: int = 0;
      for (let i = 0; i < 8; i++) {
        this.applyMask(i);
        this.drawFormatBits(i);
        const penalty: int = this.getPenaltyScore();
        if (penalty < minPenalty) {
          minPenalty = penalty;
          bestMask = i;
        }
        this.applyMask(i);
      }
      msk = bestMask;
    }
    this.mask = msk;
    this.applyMask(msk);
    this.drawFormatBits(msk);

    this.isFunction = [];
  }

  public getModule(x: int, y: int): boolean {
    return 0 <= x && x < this.size && 0 <= y && y < this.size && this.modules[y]![x]!;
  }

  private drawFunctionPatterns(): void {
    // Timing patterns
    for (let i = 0; i < this.size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }

    // Finder patterns and separators
    this.drawFinderPattern(3, 3);
    this.drawFinderPattern(this.size - 4, 3);
    this.drawFinderPattern(3, this.size - 4);

    // Alignment patterns
    const alignPatPos: Array<int> = this.getAlignmentPatternPositions();
    const numAlign: int = alignPatPos.length;
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        if (
          !(
            (i === 0 && j === 0) ||
            (i === 0 && j === numAlign - 1) ||
            (i === numAlign - 1 && j === 0)
          )
        ) {
          this.drawAlignmentPattern(alignPatPos[i]!, alignPatPos[j]!);
        }
      }
    }

    // Format bits dummy area
    this.drawFormatBits(0);
    this.drawVersion();
  }

  private drawFormatBits(mask: int): void {
    const data: int = (this.errorCorrectionLevel.formatBits << 3) | mask;
    let rem: int = data;
    for (let i = 0; i < 10; i++) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    const bits: int = ((data << 10) | rem) ^ 0x5412;
    if (bits >>> 15 !== 0) {
      throw new Error('Assertion error');
    }

    // First copy
    for (let i = 0; i <= 5; i++) {
      this.setFunctionModule(8, i, getBit(bits, i));
    }
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) {
      this.setFunctionModule(14 - i, 8, getBit(bits, i));
    }

    // Second copy
    for (let i = 0; i < 8; i++) {
      this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    }
    for (let i = 8; i < 15; i++) {
      this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
    }
    this.setFunctionModule(8, this.size - 8, true);
  }

  private drawVersion(): void {
    if (this.version < 7) {
      return;
    }
    let rem: int = this.version;
    for (let i = 0; i < 12; i++) {
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    }
    const bits: int = (this.version << 12) | rem;
    if (bits >>> 18 !== 0) {
      throw new Error('Assertion error');
    }

    for (let i = 0; i < 18; i++) {
      const color: boolean = getBit(bits, i);
      const a: int = this.size - 11 + (i % 3);
      const b: int = Math.floor(i / 3);
      this.setFunctionModule(a, b, color);
      this.setFunctionModule(b, a, color);
    }
  }

  private drawFinderPattern(x: int, y: int): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist: int = Math.max(Math.abs(dx), Math.abs(dy));
        const xx: int = x + dx;
        const yy: int = y + dy;
        if (0 <= xx && xx < this.size && 0 <= yy && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  }

  private drawAlignmentPattern(x: int, y: int): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  }

  private setFunctionModule(x: int, y: int, isDark: boolean): void {
    this.modules[y]![x] = isDark;
    this.isFunction[y]![x] = true;
  }

  private addEccAndInterleave(data: Readonly<Array<byte>>): Array<byte> {
    const ver: int = this.version;
    const ecl: QrEcc = this.errorCorrectionLevel;
    if (data.length !== QrCode.getNumDataCodewords(ver, ecl)) {
      throw new RangeError('Invalid data length');
    }

    const numBlocks: int = QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal]![ver]!;
    const blockEccLen: int = QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal]![ver]!;
    const rawCodewords: int = Math.floor(QrCode.getNumRawDataModules(ver) / 8);
    const numShortBlocks: int = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen: int = Math.floor(rawCodewords / numBlocks);

    const blocks: Array<Array<byte>> = [];
    const rsDiv: Array<byte> = QrCode.reedSolomonComputeDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat: Array<byte> = data.slice(
        k,
        k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1),
      );
      k += dat.length;
      const ecc: Array<byte> = QrCode.reedSolomonComputeRemainder(dat, rsDiv);
      if (i < numShortBlocks) {
        dat.push(0);
      }
      blocks.push(dat.concat(ecc));
    }

    const result: Array<byte> = [];
    for (let i = 0; i < blocks[0]!.length; i++) {
      blocks.forEach((block, j) => {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
          result.push(block[i]!);
        }
      });
    }
    return result;
  }

  private drawCodewords(data: Readonly<Array<byte>>): void {
    if (data.length !== Math.floor(QrCode.getNumRawDataModules(this.version) / 8)) {
      throw new RangeError('Invalid data length');
    }
    let i: int = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) {
        right = 5;
      }
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x: int = right - j;
          const upward: boolean = ((right + 1) & 2) === 0;
          const y: int = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y]![x] && i < data.length * 8) {
            this.modules[y]![x] = getBit(data[i >>> 3]!, 7 - (i & 7));
            i++;
          }
        }
      }
    }
  }

  private applyMask(mask: int): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        let invert: boolean;
        switch (mask) {
          case 0:
            invert = (x + y) % 2 === 0;
            break;
          case 1:
            invert = y % 2 === 0;
            break;
          case 2:
            invert = x % 3 === 0;
            break;
          case 3:
            invert = (x + y) % 3 === 0;
            break;
          case 4:
            invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
            break;
          case 5:
            invert = ((x * y) % 2) + ((x * y) % 3) === 0;
            break;
          case 6:
            invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          case 7:
            invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
            break;
          default:
            throw new Error('Unreachable');
        }
        if (!this.isFunction[y]![x] && invert) {
          this.modules[y]![x] = !this.modules[y]![x];
        }
      }
    }
  }

  private getPenaltyScore(): int {
    let result: int = 0;

    for (let y = 0; y < this.size; y++) {
      let runColor = false;
      let runVal = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let x = 0; x < this.size; x++) {
        if (this.modules[y]![x] === runColor) {
          runVal++;
          if (runVal === 5) {
            result += QrCode.PENALTY_N1;
          } else if (runVal > 5) {
            result++;
          }
        } else {
          this.finderPenaltyAddHistory(runVal, runHistory);
          if (!runColor) {
            result += this.finderPenaltyCountPatterns(runHistory) * QrCode.PENALTY_N3;
          }
          runColor = this.modules[y]![x]!;
          runVal = 1;
        }
      }
      this.finderPenaltyAddHistory(runVal, runHistory);
      if (!runColor) {
        result += this.finderPenaltyCountPatterns(runHistory) * QrCode.PENALTY_N3;
      }
    }

    for (let x = 0; x < this.size; x++) {
      let runColor = false;
      let runVal = 0;
      const runHistory = [0, 0, 0, 0, 0, 0, 0];
      for (let y = 0; y < this.size; y++) {
        if (this.modules[y]![x] === runColor) {
          runVal++;
          if (runVal === 5) {
            result += QrCode.PENALTY_N1;
          } else if (runVal > 5) {
            result++;
          }
        } else {
          this.finderPenaltyAddHistory(runVal, runHistory);
          if (!runColor) {
            result += this.finderPenaltyCountPatterns(runHistory) * QrCode.PENALTY_N3;
          }
          runColor = this.modules[y]![x]!;
          runVal = 1;
        }
      }
      this.finderPenaltyAddHistory(runVal, runHistory);
      if (!runColor) {
        result += this.finderPenaltyCountPatterns(runHistory) * QrCode.PENALTY_N3;
      }
    }

    for (let y = 0; y < this.size - 1; y++) {
      for (let x = 0; x < this.size - 1; x++) {
        const color: boolean = this.modules[y]![x]!;
        if (
          color === this.modules[y]![x + 1] &&
          color === this.modules[y + 1]![x] &&
          color === this.modules[y + 1]![x + 1]
        ) {
          result += QrCode.PENALTY_N2;
        }
      }
    }

    let dark: int = 0;
    for (const row of this.modules) {
      dark = row.reduce((sum, color) => sum + (color ? 1 : 0), dark);
    }
    const total: int = this.size * this.size;
    const k: int = Math.ceil(Math.abs((dark * 20) / total - 10)) - 1;
    result += k * QrCode.PENALTY_N4;
    return result;
  }

  private getAlignmentPatternPositions(): Array<int> {
    if (this.version === 1) {
      return [];
    } else {
      const num: int = Math.floor(this.version / 7) + 2;
      const step: int =
        this.version === 32
          ? 26
          : Math.ceil((this.version * 4 + 4) / (num * 2 - 2)) * 2;
      const result: Array<int> = [6];
      for (let pos = this.size - 7; result.length < num; pos -= step) {
        result.splice(1, 0, pos);
      }
      return result;
    }
  }

  private static getNumRawDataModules(ver: int): int {
    if (ver < QrCode.MIN_VERSION || ver > QrCode.MAX_VERSION) {
      throw new RangeError('Version out of range');
    }
    const size: int = ver * 4 + 17;
    let result: int = size * size;
    result -= 8 * 8 * 3;
    result -= 15 * 2 + 1;
    result -= (size - 16) * 2;
    if (ver >= 2) {
      const numAlign: int = Math.floor(ver / 7) + 2;
      result -= (numAlign * numAlign - 3) * 25;
      result += (numAlign - 2) * 2 * 20;
      if (ver >= 7) {
        result -= 6 * 3 * 2;
      }
    }
    return result;
  }

  private static getNumDataCodewords(ver: int, ecl: QrEcc): int {
    return (
      Math.floor(QrCode.getNumRawDataModules(ver) / 8) -
      QrCode.ECC_CODEWORDS_PER_BLOCK[ecl.ordinal]![ver]! *
        QrCode.NUM_ERROR_CORRECTION_BLOCKS[ecl.ordinal]![ver]!
    );
  }

  private static reedSolomonComputeDivisor(degree: int): Array<byte> {
    if (degree < 1 || degree > 255) {
      throw new RangeError('Degree out of range');
    }
    const result: Array<byte> = [];
    for (let i = 0; i < degree - 1; i++) {
      result.push(0);
    }
    result.push(1);

    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < result.length; j++) {
        result[j] = QrCode.reedSolomonMultiply(result[j] ?? 0, root);
        if (j + 1 < result.length) {
          result[j] = (result[j] ?? 0) ^ (result[j + 1] ?? 0);
        }
      }
      root = QrCode.reedSolomonMultiply(root, 0x02);
    }
    return result;
  }

  private static reedSolomonComputeRemainder(
    data: Readonly<Array<byte>>,
    divisor: Readonly<Array<byte>>,
  ): Array<byte> {
    const result: Array<byte> = divisor.map(() => 0);
    for (const b of data) {
      const factor: byte = b ^ (result.shift() ?? 0);
      result.push(0);
      divisor.forEach((coef, i) => {
        result[i] = (result[i] ?? 0) ^ QrCode.reedSolomonMultiply(coef, factor);
      });
    }
    return result;
  }

  private static reedSolomonMultiply(x: byte, y: byte): byte {
    if (x >>> 8 !== 0 || y >>> 8 !== 0) {
      throw new RangeError('Byte out of range');
    }
    let z: int = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z as byte;
  }

  private finderPenaltyAddHistory(currentRunLength: int, runHistory: Array<int>): void {
    if (runHistory[0] === 0) {
      currentRunLength += this.size;
    }
    runHistory.pop();
    runHistory.unshift(currentRunLength);
  }

  private finderPenaltyCountPatterns(runHistory: Readonly<Array<int>>): int {
    const n: int = runHistory[1]!;
    const core: boolean =
      n > 0 &&
      runHistory[2] === n &&
      runHistory[3] === n * 3 &&
      runHistory[4] === n &&
      runHistory[5] === n;
    return (
      (core && runHistory[0]! >= n * 4 && runHistory[6]! >= n ? 1 : 0) +
      (core && runHistory[6]! >= n * 4 && runHistory[0]! >= n ? 1 : 0)
    );
  }

  private static readonly PENALTY_N1: int = 3;
  private static readonly PENALTY_N2: int = 3;
  private static readonly PENALTY_N3: int = 40;
  private static readonly PENALTY_N4: int = 10;

  private static readonly ECC_CODEWORDS_PER_BLOCK: Array<Array<int | null>> = [
    [null, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [null, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [null, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [null, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];

  private static readonly NUM_ERROR_CORRECTION_BLOCKS: Array<Array<int | null>> = [
    [null, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [null, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [null, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [null, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];
}

function appendBits(val: int, len: int, bb: Array<int>): void {
  if (len < 0 || len > 31 || val >>> len !== 0) {
    throw new RangeError('Value out of range');
  }
  for (let i = len - 1; i >= 0; i--) {
    bb.push((val >>> i) & 1);
  }
}

function getBit(x: int, i: int): boolean {
  return ((x >>> i) & 1) !== 0;
}

function toUtf8ByteArray(str: string): Array<byte> {
  const utf8: Array<byte> = [];
  for (let i = 0; i < str.length; i++) {
    let charcode = str.charCodeAt(i);
    if (charcode < 0x80) {
      utf8.push(charcode);
    } else if (charcode < 0x800) {
      utf8.push(0xc0 | (charcode >> 6), 0x80 | (charcode & 0x3f));
    } else if (charcode < 0xd800 || charcode >= 0xe000) {
      utf8.push(
        0xe0 | (charcode >> 12),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f),
      );
    } else {
      i++;
      charcode = 0x10000 + (((charcode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
      utf8.push(
        0xf0 | (charcode >> 18),
        0x80 | ((charcode >> 12) & 0x3f),
        0x80 | ((charcode >> 6) & 0x3f),
        0x80 | (charcode & 0x3f),
      );
    }
  }
  return utf8;
}
