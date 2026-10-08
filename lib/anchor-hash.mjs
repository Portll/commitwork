import { createHash } from 'node:crypto';

// contract: 12-hex sha256 of the trimmed line
export const hashLine = (text) =>
  createHash('sha256').update(String(text ?? '').trim()).digest('hex').slice(0, 12);
