import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';

const publicDirectory = fileURLToPath(new URL('../../public/', import.meta.url));

export default async function webRoutes(fastify: FastifyInstance) {
  fastify.get('/', async (_request, reply) => {
    const page = await readFile(new URL('../../public/index.html', import.meta.url));
    return reply.type('text/html; charset=utf-8').send(page);
  });

  fastify.get('/app.css', async (_request, reply) => {
    const stylesheet = await readFile(`${publicDirectory}app.css`);
    return reply.type('text/css; charset=utf-8').send(stylesheet);
  });

  fastify.get('/app.js', async (_request, reply) => {
    const script = await readFile(`${publicDirectory}app.js`);
    return reply.type('text/javascript; charset=utf-8').send(script);
  });
}
