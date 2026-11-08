// scripts/db-init.js
// Crea las tablas de sql/schema.sql. Se puede correr las veces que haga falta
// (todo usa IF NOT EXISTS / ON CONFLICT DO NOTHING).
//   npm run db:init

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool } = require('../db');

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf-8');
  try {
    await pool.query(sql);
    console.log('✅ Tablas listas.');
  } catch (err) {
    console.error('❌ No se pudo crear el esquema:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
