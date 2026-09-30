const pool = require('../config/db');

const crearUsuario = async ({ tipo_cuenta, correo, nombres, apellidos }) => {
    const { rows } = await pool.query(
        `INSERT INTO usuarios (tipo_cuenta, correo, nombres, apellidos)
         VALUES ($1, $2, $3, $4)
         RETURNING id, tipo_cuenta, correo, nombres, apellidos, estado, correo_verificado, creado_en`,
        [tipo_cuenta, correo, nombres, apellidos]
    );
    return rows[0];
};

const buscarPorCorreo = async (correo) => {
    const { rows } = await pool.query(
        `SELECT * FROM usuarios WHERE correo = $1`,
        [correo]
    );
    return rows[0] || null;
};

const buscarPorId = async (id) => {
    const { rows } = await pool.query(
        `SELECT * FROM usuarios WHERE id = $1`,
        [id]
    );
    return rows[0] || null;
};

const actualizarUltimoAcceso = async (usuarioId) => {
    await pool.query(
        `UPDATE usuarios SET ultimo_acceso_en = NOW() WHERE id = $1`,
        [usuarioId]
    );
};

const marcarCorreoVerificado = async (usuarioId) => {
    await pool.query(
        `UPDATE usuarios SET correo_verificado = TRUE, correo_verificado_en = NOW() WHERE id = $1`,
        [usuarioId]
    );
};

// 'client' permite ejecutarlo dentro de la transacción de edición de perfil.
const actualizarDatosPerfil = async ({ usuarioId, nombres, apellidos, fotoPerfil, fotoPortada, telefono, mostrarTelefono, client }) => {
    const db = client || pool;
    await db.query(
        `UPDATE usuarios
         SET nombres = $2, apellidos = $3, foto_perfil = $4, telefono = $5, mostrar_telefono = $6, foto_portada = $7
         WHERE id = $1`,
        [usuarioId, nombres, apellidos, fotoPerfil, telefono, mostrarTelefono, fotoPortada]
    );
};

// Va aparte de actualizarDatosPerfil: así el resto de la edición del perfil
// sigue funcionando en una base sin la migración de privacidad_perfil.
const actualizarPrivacidad = async ({ usuarioId, privacidad, client }) => {
    const db = client || pool;
    await db.query(`UPDATE usuarios SET privacidad_perfil = $2 WHERE id = $1`, [
        usuarioId,
        JSON.stringify(privacidad),
    ]);
};

module.exports = {
    crearUsuario,
    buscarPorCorreo,
    buscarPorId,
    actualizarUltimoAcceso,
    marcarCorreoVerificado,
    actualizarDatosPerfil,
    actualizarPrivacidad,
};