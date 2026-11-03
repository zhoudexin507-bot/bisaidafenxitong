// The local .env intentionally runs the API in development; never bundle React's dev runtime.
process.env.NODE_ENV = 'production';
const { build } = await import('vite');
await build();
