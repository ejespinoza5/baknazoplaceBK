const pool = require('../config/db');

const crearCuentaCorreo = async ({ usuario_id, contrasena_hash }) => {
    const { rows } = await pool.query(
        `INSERT INTO cuentas_autenticacion (usuario_id, proveedor, contrasena_hash)
         VALUES ($1, 'CORREO', $2)
         RETURNING id`,
        [usuario_id, contrasena_hash]
    );
    return rows[0];
};

const buscarCuentaCorreo = async (usuario_id) => {
    const { rows } = await pool.query(
        `SELECT * FROM cuentas_autenticacion
         WHERE usuario_id = $1 AND proveedor = 'CORREO'`,
        [usuario_id]
    );
    return rows[0] || null;
};

const buscarCuentaPorProveedor = async (proveedor, idProveedor) => {
    const { rows } = await pool.query(
        `SELECT * FROM cuentas_autenticacion WHERE proveedor = $1 AND id_proveedor = $2`,
        [proveedor, idProveedor]
    );
    return rows[0] || null;
};

const crearCuentaProveedor = async ({ usuarioId, proveedor, idProveedor }) => {
    const { rows } = await pool.query(
        `INSERT INTO cuentas_autenticacion (usuario_id, proveedor, id_proveedor)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [usuarioId, proveedor, idProveedor]
    );
    return rows[0];
};

const actualizarContrasena = async (usuarioId, contrasenaHash) => {
    await pool.query(
        `UPDATE cuentas_autenticacion SET contrasena_hash = $1
         WHERE usuario_id = $2 AND proveedor = 'CORREO'`,
        [contrasenaHash, usuarioId]
    );
};

module.exports = {
    crearCuentaCorreo,
    buscarCuentaCorreo,
    buscarCuentaPorProveedor,
    crearCuentaProveedor,
    actualizarContrasena,
};