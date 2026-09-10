import { build } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Bundle implementation modules; keep Editor components readable and reusable.
export async function bundleModule(entry, filename) {
    await build({
        configFile: false,
        build: {
            lib: { entry, formats: ['es'], fileName: () => filename },
            outDir: 'dist-editor', emptyOutDir: false, minify: false, target: 'esnext',
            rollupOptions: { external: ['playcanvas'] }
        }
    });
}

export async function copyComponent(source, filename, imports = {}) {
    let code = await readFile(source, 'utf8');
    for (const [from, to] of Object.entries(imports)) {
        if (!code.includes(from)) throw new Error(`Missing import in ${source}: ${from}`);
        code = code.replace(from, to);
    }
    await mkdir('dist-editor', { recursive: true });
    await writeFile(`dist-editor/${filename}`, `// Generated from ${source}. Keep its companion modules in the same Editor folder.\n${code}`);
}
