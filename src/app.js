require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const env = require('./config/env'); // Valida variables de entorno obligatorias (falla rápido si faltan)
require('./config/db'); // Importa la configuración de la base de datos
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const app = express();

app.use(helmet());
app.use(cors({
    origin: env.corsOrigin.length > 0 ? env.corsOrigin : false,
}));
app.use(express.json({ limit: '10kb' }));

// Rutas de autenticación
app.use('/api/auth', authRoutes);

// Manejador de errores centralizado (nunca exponer detalles internos/stack al cliente)
app.use((err, req, res, next) => {
    console.error(err.stack || err.message);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error interno' });
});

app.get('/', (req, res) => {
    res.json({ mensaje: 'API funcionando' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor en http://localhost:${PORT}`);
});