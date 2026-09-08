const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Prueba de conexión
pool.query('SELECT NOW()')
    .then((res) => {
        console.log('Conectado a la BDD:', res.rows[0].now);
    })
    .catch((err) => {
        console.error('Error al conectar a la BDD:', err.message);
    });

module.exports = pool;