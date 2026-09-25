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

// Reemplaza todos los datos editables del negocio. 'client' permite usarlo en una transacción.
const actualizarPorUsuario = async (usuarioId, datos, client) => {
    const db = client || pool;
    await db.query(
        `UPDATE negocios SET
             nombre_comercial = $2, categoria_id = $3, descripcion_breve = $4, logo_url = $5,
             provincia = $6, ciudad = $7, sector = $8, direccion_local = $9, tiene_local = $10,
             latitud = $11, longitud = $12, telefono = $13, whatsapp = $14, correo_contacto = $15,
             redes_sociales = $16, horario_atencion = $17, entrega_domicilio = $18, zona_cobertura = $19
         WHERE usuario_id = $1`,
        [
            usuarioId,
            datos.nombreComercial,
            datos.categoriaId,
            datos.descripcionBreve,
            datos.logoUrl,
            datos.provincia,
            datos.ciudad,
            datos.sector,
            datos.direccionLocal,
            datos.tieneLocal,
            datos.latitud,
            datos.longitud,
            datos.telefono,
            datos.whatsapp,
            datos.correoContacto,
            aJson(datos.redes),
            aJson(datos.horario),
            datos.entregaDomicilio,
            datos.zonaCobertura,
        ]
    );
};

module.exports = { crearNegocio, buscarPorUsuario, buscarPorUsuarioConCategoria, actualizarPorUsuario };