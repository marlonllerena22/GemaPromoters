import { copyFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

const scannerHtml = resolve('dist/scanner.html');
const indexHtml = resolve('dist/index.html');
await copyFile(scannerHtml, indexHtml);
await unlink(scannerHtml);
