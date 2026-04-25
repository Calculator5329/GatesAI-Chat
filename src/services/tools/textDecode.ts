import type { FsReadResp } from '../../core/workspace';

/**
 * Shared text decoding for fs.read responses.
 *
 * The bridge returns either utf8 (already a string) or base64 (raw bytes
 * that may or may not be text). Both `fs.read` and `inspect_file` need
 * to turn that into a real string when possible, and recognize when the
 * content is genuinely binary so we don't dump base64 into the model.
 */

export type DecodedFsRead =
  | { kind: 'text'; text: string; encoding: string }
  | { kind: 'binary'; reason: string };

export function decodeFsRead(resp: FsReadResp): DecodedFsRead {
  if (resp.encoding === 'utf8') {
    const normalized = normalizeDecodedText(resp.content);
    return {
      kind: 'text',
      text: normalized.text,
      encoding: normalized.hadBom ? 'utf-8-bom' : 'utf-8',
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(resp.content);
  } catch (err) {
    return { kind: 'binary', reason: `base64 decode failed: ${(err as Error).message}` };
  }

  const decoded = decodeBytes(bytes);
  if (looksBinary(decoded.text)) {
    return { kind: 'binary', reason: 'content contains binary bytes' };
  }
  return { kind: 'text', text: decoded.text, encoding: decoded.encoding };
}

function decodeBytes(bytes: Uint8Array): { text: string; encoding: string } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: normalizeDecodedText(decodeUtf16(bytes.slice(2), true)).text, encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: normalizeDecodedText(decodeUtf16(bytes.slice(2), false)).text, encoding: 'utf-16be' };
  }
  const nulPattern = detectUtf16ByNulPattern(bytes);
  if (nulPattern) {
    return { text: normalizeDecodedText(decodeUtf16(bytes, nulPattern === 'utf-16le')).text, encoding: nulPattern };
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const normalized = normalizeDecodedText(text);
    return { text: normalized.text, encoding: normalized.hadBom ? 'utf-8-bom' : 'utf-8' };
  } catch {
    return { text: normalizeDecodedText(decodeWindows1252(bytes)).text, encoding: 'windows-1252' };
  }
}

function base64ToBytes(content: string): Uint8Array {
  const clean = content.replace(/\s+/g, '');
  const binary = globalThis.atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function detectUtf16ByNulPattern(bytes: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const sample = bytes.slice(0, Math.min(bytes.length, 200));
  let evenNuls = 0;
  let oddNuls = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) evenNuls++;
      else oddNuls++;
    }
  }
  if (oddNuls > evenNuls * 3 && oddNuls >= 2) return 'utf-16le';
  if (evenNuls > oddNuls * 3 && evenNuls >= 2) return 'utf-16be';
  return null;
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let text = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1];
    text += String.fromCharCode(code);
  }
  return text;
}

const WINDOWS_1252 = new Map<number, string>([
  [0x80, '€'], [0x82, '‚'], [0x83, 'ƒ'], [0x84, '„'], [0x85, '…'], [0x86, '†'], [0x87, '‡'],
  [0x88, 'ˆ'], [0x89, '‰'], [0x8a, 'Š'], [0x8b, '‹'], [0x8c, 'Œ'], [0x8e, 'Ž'], [0x91, '‘'],
  [0x92, '’'], [0x93, '“'], [0x94, '”'], [0x95, '•'], [0x96, '–'], [0x97, '—'], [0x98, '˜'],
  [0x99, '™'], [0x9a, 'š'], [0x9b, '›'], [0x9c, 'œ'], [0x9e, 'ž'], [0x9f, 'Ÿ'],
]);

function decodeWindows1252(bytes: Uint8Array): string {
  return Array.from(bytes, byte => WINDOWS_1252.get(byte) ?? String.fromCharCode(byte)).join('');
}

export function normalizeDecodedText(text: string): { text: string; hadBom: boolean } {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const hadBom = normalized.charCodeAt(0) === 0xfeff;
  return { text: stripBom(normalized), hadBom };
}

export function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

/**
 * Heuristic: text that survived utf-8/utf-16/windows-1252 decoding can
 * still be binary garbage (e.g. a .xlsx that we forced through cp1252).
 * Treat it as binary if it contains NUL bytes or a high fraction of
 * other C0 control chars (excluding tab/newline/CR).
 */
function looksBinary(text: string): boolean {
  if (text.length === 0) return false;
  const sampleLen = Math.min(text.length, 4096);
  let control = 0;
  for (let i = 0; i < sampleLen; i++) {
    const code = text.charCodeAt(i);
    if (code === 0) return true;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) control++;
    else if (code === 0xfffd) control++;
  }
  return control / sampleLen > 0.05;
}
