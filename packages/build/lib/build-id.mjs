// The build id of an application (HY-125): the SHA-256 digest of the stream of its output files, in the order of their paths.
import { createHash } from 'node:crypto';

const NUL = Buffer.from([0]);

/**
 * Returns a copy of `files` sorted by the bytes of their UTF-8 paths. A path that occurs twice fails with its name.
 * @param {{ path: string, bytes: Buffer }[]} files
 * @returns {{ path: string, bytes: Buffer }[]}
 */
export function sortFiles(files) {
  const sorted = [...files].sort((a, b) => Buffer.compare(Buffer.from(a.path, 'utf8'), Buffer.from(b.path, 'utf8')));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].path === sorted[i].path) throw new Error(`duplicate build file path: ${sorted[i].path}`);
  }
  return sorted;
}

/**
 * Returns the bytes that the build id hashes: for each file in path order, its UTF-8 path, a NUL byte, its length as
 * 8 bytes big-endian and its bytes.
 * @param {{ path: string, bytes: Buffer }[]} files
 * @returns {Buffer}
 */
export function buildStream(files) {
  const parts = [];
  for (const file of sortFiles(files)) {
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(file.bytes.length));
    parts.push(Buffer.from(file.path, 'utf8'), NUL, length, file.bytes);
  }
  return Buffer.concat(parts);
}

/**
 * Returns the lowercase hexadecimal SHA-256 digest of `buildStream(files)`.
 * @param {{ path: string, bytes: Buffer }[]} files
 * @returns {string}
 */
export function buildId(files) {
  return createHash('sha256').update(buildStream(files)).digest('hex');
}
