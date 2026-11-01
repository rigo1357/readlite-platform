export default {
  'database-url-var':
    process.env.DATABASE_URL ?? 'postgres://readlite:readlite_local@localhost:5432/readlite',
  'migrations-dir': '../../db/migrations',
  verbose: true,
};
