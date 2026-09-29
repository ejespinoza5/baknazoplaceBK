const perfilModel = require('../models/perfilModel');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const error = (mensaje, status) => {
    const err = new Error(mensaje);
    err.status = status;
    return err;
};

const validarId = (id) => {
    if (!UUID.test(id || '')) throw error('Usuario no encontrado', 404);
};

const urlPublica = (base, ruta) => {
    if (!ruta) return null;
    if (/^https?:\/\//i.test(ruta)) return ruta;
    return `${base}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
};

const nombreDe = (f) =>
    f.tipo_cuenta === 'NEGOCIO' && f.nombre_comercial
        ? f.nombre_comercial
        : [f.nombres, f.apellidos].filter(Boolean).join(' ');

const fotoDe = (base, f) => urlPublica(base, f.tipo_cuenta === 'NEGOCIO' ? f.logo_url || f.foto_perfil : f.foto_perfil);

const precioTexto = (precio, moneda) => {
    if (precio === null || precio === undefined) return 'A convenir';
    const n = Number(precio).toFixed(2);
    return moneda === 'USD' ? `$${n}` : `${n} ${moneda}`;
};

const ubicacionTexto = (ciudad, sector) => [ciudad, sector].filter(Boolean).join(' · ') || null;

// Horario guardado como [{dia, apertura, cierre}] → [{dia, abierto, desde, hasta}].
const horarioPublico = (horario) => {
    if (!Array.isArray(horario)) return [];
    return horario.map((h) => ({
        dia: h.dia,
        abierto: h.abierto !== undefined ? Boolean(h.abierto) : Boolean(h.apertura && h.cierre),
        desde: h.apertura || null,
        hasta: h.cierre || null,
    }));
};

// Redes guardadas como { instagram: url } → [{ etiqueta, url }].
const redesPublicas = (redes) => {
    if (!redes || typeof redes !== 'object' || Array.isArray(redes)) return [];
    return Object.entries(redes).map(([red, url]) => ({
        etiqueta: red.charAt(0).toUpperCase() + red.slice(1),
        url,
    }));
};

const anuncioPublico = (base, a) => ({
    id: Number(a.id),
    titulo: a.titulo,
    precio: precioTexto(a.precio, a.moneda),
    ubicacion: ubicacionTexto(a.canton_nombre, a.sector),
    pilar: a.pilar,
    foto: a.portada_key ? urlPublica(base, `/uploads/${a.portada_key}`) : null,
    sinFoto: !a.portada_key,
    vendido: a.vendido,
    publicadoEn: a.publicado_en,
    likes: a.likes,
    vistas: a.vistas,
});

const entero = (valor, defecto, min, max) => {
    const n = Number.parseInt(valor, 10);
    if (Number.isNaN(n)) return defecto;
    return Math.min(Math.max(n, min), max);
};

// ?limite=20&offset=0 (limite máx. 50).
const paginacionDe = (query = {}) => ({
    limite: entero(query.limite, 20, 1, 50),
    offset: entero(query.offset, 0, 0, 100000),
});

const infoPagina = ({ limite, offset }, total) => ({ limite, offset, total, hayMas: offset + limite < total });

const obtenerPerfil = async ({ usuarioId, visitanteId, base, query }) => {
    validarId(usuarioId);
    const f = await perfilModel.obtenerPerfilPublico(usuarioId, visitanteId);
    if (!f) throw error('Usuario no encontrado', 404);

    const pagina = paginacionDe(query);
    const anuncios = (await perfilModel.listarAnunciosPublicos(usuarioId, pagina)).map((a) => anuncioPublico(base, a));
    const esNegocio = f.tipo_cuenta === 'NEGOCIO';

    // El teléfono personal nunca es público: solo se exponen los datos de contacto del negocio.
    const telefono = esNegocio ? f.negocio_telefono || null : null;
    const whatsapp = esNegocio ? f.negocio_whatsapp || null : null;

    return {
        perfil: {
            id: f.id,
            tipo: f.tipo_cuenta,
            nombre: nombreDe(f),
            foto: fotoDe(base, f),
            foto_portada: urlPublica(base, f.foto_portada),
            verificado: Boolean(f.correo_verificado),
            publicados: f.publicados,
            vendidos: f.vendidos,
            likes: f.likes,
            ubicacion: esNegocio ? ubicacionTexto(f.ciudad, f.sector) : anuncios[0]?.ubicacion || null,
            miembroDesde: new Date(f.creado_en).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' }),
            seguidores: f.seguidores,
            seguidos: f.seguidos,
            loSigues: Boolean(f.lo_sigues),
            contacto: whatsapp ? 'whatsapp' : telefono ? 'telefono' : null,
            categoria: esNegocio ? f.categoria_nombre || null : null,
            descripcion: esNegocio ? f.descripcion_breve || null : null,
            direccion: esNegocio ? f.direccion_local || null : null,
            horario: esNegocio ? horarioPublico(f.horario_atencion) : [],
            entregaDomicilio: esNegocio ? Boolean(f.entrega_domicilio) : false,
            zonaCobertura: esNegocio ? f.zona_cobertura || null : null,
            telefono,
            whatsapp,
            redes: esNegocio ? redesPublicas(f.redes_sociales) : [],
            // Aún no hay sistema de valoraciones.
            valoracion: null,
            numeroValoraciones: 0,
        },
        anuncios,
        // 'publicados' = total de anuncios listables (mismo filtro que la consulta).
        paginacion: infoPagina(pagina, f.publicados),
    };
};

// Solo los anuncios (páginas siguientes), sin volver a pedir todo el perfil.
const listarAnuncios = async ({ usuarioId, base, query }) => {
    validarId(usuarioId);
    const f = await perfilModel.obtenerPerfilPublico(usuarioId, null);
    if (!f) throw error('Usuario no encontrado', 404);
    const pagina = paginacionDe(query);
    const filas = await perfilModel.listarAnunciosPublicos(usuarioId, pagina);
    return {
        anuncios: filas.map((a) => anuncioPublico(base, a)),
        paginacion: infoPagina(pagina, f.publicados),
    };
};

const seguir = async ({ seguidorId, seguidoId }) => {
    validarId(seguidoId);
    if (seguidorId === seguidoId) throw error('No puedes seguirte a ti mismo', 400);
    if (!(await perfilModel.existeActivo(seguidoId))) throw error('Usuario no encontrado', 404);
    await perfilModel.seguir(seguidorId, seguidoId);
    return { seguidores: await perfilModel.contarRelacion(seguidoId, 'seguidores') };
};

const dejarDeSeguir = async ({ seguidorId, seguidoId }) => {
    validarId(seguidoId);
    await perfilModel.dejarDeSeguir(seguidorId, seguidoId);
    return { seguidores: await perfilModel.contarRelacion(seguidoId, 'seguidores') };
};

// direccion = 'seguidores' | 'seguidos'. Paginación con ?limite=20&offset=0.
const listarRelacion = async ({ usuarioId, direccion, query, base }) => {
    validarId(usuarioId);
    if (!(await perfilModel.existeActivo(usuarioId))) throw error('Usuario no encontrado', 404);
    const pagina = paginacionDe(query);
    const [filas, total] = await Promise.all([
        perfilModel.listarRelacion(usuarioId, direccion, pagina),
        perfilModel.contarRelacion(usuarioId, direccion),
    ]);
    return {
        [direccion]: filas.map((f) => ({
            id: f.id,
            tipo: f.tipo_cuenta,
            nombre: nombreDe(f),
            foto: fotoDe(base, f),
            desde: f.creado_en,
        })),
        total,
        paginacion: infoPagina(pagina, total),
    };
};

module.exports = { obtenerPerfil, listarAnuncios, seguir, dejarDeSeguir, listarRelacion };
