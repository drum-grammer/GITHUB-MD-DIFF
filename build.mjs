import { bundle } from './scripts/build-lib.mjs';

await bundle({ outdir: 'dist' });
