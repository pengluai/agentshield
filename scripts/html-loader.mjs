import { readFile } from 'node:fs/promises';

export async function load(url, context, defaultLoad) {
  if (url.endsWith('.html')) {
    const html = await readFile(new URL(url), 'utf8');
    return {
      format: 'module',
      shortCircuit: true,
      source: `export default ${JSON.stringify(html)};`,
    };
  }
  return defaultLoad(url, context, defaultLoad);
}
