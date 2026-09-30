const pool = require('../config/db');

// Datos públicos del usuario + su negocio + contadores (una sola consulta).
const obtenerPerfilPublico = async (usuarioId, visitanteId) => {
    const { rows } = await pool.query(
        `SELECT u.id, u.tipo_cuenta, u.nombres, u.apellidos, u.foto_perfil, u.foto_portada,
                u.correo_verificado, u.creado_en,
                -- to_jsonb en vez de la columna directa: si la migración de
                -- privacidad aún no corrió, sale NULL en lugar de romper la consulta.
                to_jsonb(u) -> 'privacidad_perfil' AS privacidad_perfil,
                n.nombre_comercial, n.logo_url, n.descripcion_breve, n.ciudad, n.sector,
                n.direccion_local, n.horario_atencion, n.entrega_domicilio, n.zona_cobertura,
                n.telefono AS negocio_telefono, n.whatsapp AS negocio_whatsapp, n.redes_sociales,
                n.latitud, n.longitud,
                cat.nombre AS categoria_nombre,
                (SELECT COUNT(*) FROM anuncios a
                  WHERE a.autor_usuario_id = u.id AND a.estado = 'PUBLICADO' AND a.eliminado_en IS NULL)::int AS publicados,
                (SELECT COUNT(*) FROM anuncios a
                  WHERE a.autor_usuario_id = u.id AND a.estado = 'PUBLICADO' AND NOT a.vendido
                    AND a.eliminado_en IS NULL)::int AS disponibles,
                (SELECT COUNT(*) FROM anuncios a
                  WHERE a.autor_usuario_id = u.id AND a.vendido AND a.eliminado_en IS NULL)::int AS vendidos,
                (SELECT COUNT(*) FROM anuncio_likes l JOIN anuncios a ON a.id = l.anuncio_id
                  WHERE a.autor_usuario_id = u.id AND a.eliminado_en IS NULL)::int AS likes,
                (SELECT COUNT(*) FROM seguidores s WHERE s.seguido_id = u.id)::int AS seguidores,
                (SELECT COUNT(*) FROM seguidores s WHERE s.seguidor_id = u.id)::int AS seguidos,
                EXISTS (SELECT 1 FROM seguidores s WHERE s.seguidor_id = $2 AND s.seguido_id = u.id) AS lo_sigues
         FROM usuarios u
         LEFT JOIN negocios n ON n.usuario_id = u.id
         LEFT JOIN categorias cat ON cat.id = n.categoria_id
         WHERE u.id = $1 AND u.estado = 'ACTIVO'`,
        [usuarioId, visitanteId || null]
    );
    return rows[0] || null;
};

// Anuncios públicos del usuario (publicados, incluidos los vendidos), con su foto de portada.
// soloDisponibles deja fuera los vendidos (cuando el dueño oculta sus ventas).
const listarAnunciosPublicos = async (usuarioId, { limite, offset }, soloDisponibles = false) => {
    const { rows } = await pool.query(
        `SELECT a.id, a.titulo, a.precio, a.moneda, a.pilar, a.vendido, a.publicado_en, a.vistas,
                a.sector, c.nombre AS canton_nombre, f0.storage_key AS portada_key,
                (SELECT COUNT(*) FROM anuncio_likes l WHERE l.anuncio_id = a.id)::int AS likes
         FROM anuncios a
         JOIN cantones c ON c.codigo = a.canton_codigo
         LEFT JOIN anuncio_fotos f0 ON f0.anuncio_id = a.id AND f0.orden = 0
         WHERE a.autor_usuario_id = $1 AND a.estado = 'PUBLICADO' AND a.eliminado_en IS NULL
           AND (NOT $4::boolean OR NOT a.vendido)
         ORDER BY a.vendido, a.publicado_en DESC, a.id DESC
         LIMIT $2 OFFSET $3`,
        [usuarioId, limite, offset, soloDisponibles]
    );
    return rows;
};

const existeActivo = async (usuarioId) => {
    const { rows } = await pool.query(`SELECT 1 FROM usuarios WHERE id = $1 AND estado = 'ACTIVO'`, [usuarioId]);
    return rows.length > 0;
};

const seguir = async (seguidorId, seguidoId) => {
    await pool.query(
        `INSERT INTO seguidores (seguidor_id, seguido_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [seguidorId, seguidoId]
    );
};

const dejarDeSeguir = async (seguidorId, seguidoId) => {
    await pool.query(`DELETE FROM seguidores WHERE seguidor_id = $1 AND seguido_id = $2`, [seguidorId, seguidoId]);
};

// direccion = 'seguidores' (quién sigue a usuarioId) o 'seguidos' (a quién sigue usuarioId).
const contarRelacion = async (usuarioId, direccion) => {
    const filtro = direccion === 'seguidores' ? 'seguido_id' : 'seguidor_id';
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS total FROM seguidores WHERE ${filtro} = $1`, [usuarioId]);
    return rows[0].total;
};

const listarRelacion = async (usuarioId, direccion, { limite, offset }) => {
    const [filtro, otro] = direccion === 'seguidores' ? ['seguido_id', 'seguidor_id'] : ['seguidor_id', 'seguido_id'];
    const { rows } = await pool.query(
        `SELECT u.id, u.tipo_cuenta, u.nombres, u.apellidos, u.foto_perfil,
                n.nombre_comercial, n.logo_url, s.creado_en
         FROM seguidores s
         JOIN usuarios u ON u.id = s.${otro} AND u.estado = 'ACTIVO'
         LEFT JOIN negocios n ON n.usuario_id = u.id
         WHERE s.${filtro} = $1
         ORDER BY s.creado_en DESC
         LIMIT $2 OFFSET $3`,
        [usuarioId, limite, offset]
    );
    return rows;
};

module.exports = {
    obtenerPerfilPublico,
    listarAnunciosPublicos,
    existeActivo,
    seguir,
    dejarDeSeguir,
    contarRelacion,
    listarRelacion,
};
