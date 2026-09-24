const pool = require('../config/db');

// node-postgres serializa arrays como literales de Postgres; hay que emitir JSON explícito para jsonb.
const aJson = (valor) => (valor === undefined || valor === null ? null : JSON.stringify(valor));

const crearNegocio = async ({
    usuarioId,
    nombreComercial,
    categoriaId,
    descripcionBreve,
    logoUrl,
    provincia,
    ciudad,
    sector,
    direccionLocal,
    tieneLocal,
    latitud,
    longitud,
    telefono,
    whatsapp,
    correoContacto,
    redesSociales,
    horarioAtencion,
    entregaDomicilio,
    zonaCobertura,
}) => {
    const { rows } = await pool.query(
        `INSERT INTO negocios (
             usuario_id, nombre_comercial, categoria_id, descripcion_breve, logo_url,
             provincia, ciudad, sector, direccion_local, tiene_local, latitud, longitud,
             telefono, whatsapp, correo_contacto, redes_sociales, horario_atencion,
             entrega_domicilio, zona_cobertura
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
         RETURNING *`,
        [
            usuarioId,
            nombreComercial,
            categoriaId,
            descripcionBreve,
            logoUrl,
            provincia,
            ciudad,
            sector,
            direccionLocal,
            tieneLocal,
            latitud,
            longitud,
            telefono,
            whatsapp,
            correoContacto,
            aJson(redesSociales),
            aJson(horarioAtencion),
            entregaDomicilio,
            zonaCobertura,
        ]
    );
    return rows[0];
};

const buscarPorUsuario = async (usuarioId) => {
    const { rows } = await pool.query(`SELECT * FROM negocios WHERE usuario_id = $1`, [usuarioId]);
    return rows[0] || null;
};

// Igual que buscarPorUsuario pero incluye el nombre de la categoría.
const buscarPorUsuarioConCategoria = async (usuarioId) => {
    const { rows } = await pool.query(
        `SELECT n.*, c.nombre AS categoria_nombre
         FROM negocios n
         LEFT JOIN categorias c ON c.id = n.categoria_id
         WHERE n.usuario_id = $1`,
        [usuarioId]
    );
    return rows[0] || null;
};

module.exports = { crearNegocio, buscarPorUsuario, buscarPorUsuarioConCategoria };