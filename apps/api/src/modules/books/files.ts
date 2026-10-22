/** Где лежат свои обложки книг (вне базы, в базе только ключ) */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
export const COVERS = () => process.env.COVERS_DIR || path.join(ROOT, 'data', 'covers-next');
