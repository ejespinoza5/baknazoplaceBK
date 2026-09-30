const perfilModel = require('../models/perfilModel');
const { privacidadDe } = require('../utils/privacidad');

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

// Qué ve este visitante. El dueño lo ve todo; el resto, lo que el dueño dejó visible.
const visibleParaVisitante = (f, visitanteId) => {
    const privacidad = privacidadDe(f.privacidad_perfil);
    const esDueno = Boolean(visitanteId) && visitanteId === f.id;
    const ve = (clave) => esDueno || privacidad[clave];
    return { privacidad, esDueno, ve };
};

const obtenerPerfil = async ({ usuarioId, visitanteId, base, query }) => {
    validarId(usuarioId);
    const f = await perfilModel.obtenerPerfilPublico(usuarioId, visitanteId);
    if (!f) throw error('Usuario no encontrado', 404);

    const { privacidad, ve } = visibleParaVisitante(f, visitanteId);
    const verVendidos = ve('vendidos');

    const pagina = paginacionDe(query);
    const anuncios = (await perfilModel.listarAnunciosPublicos(usuarioId, pagina, !verVendidos)).map((a) =>
        anuncioPublico(base, a)
    );
    const esNegocio = f.tipo_cuenta === 'NEGOCIO';

    // El teléfono personal nunca es público: solo se exponen los datos de contacto del negocio,
    // y solo si el dueño no los ocultó.
    const verContacto = esNegocio && ve('contacto_negocio');
    const telefono = verContacto ? f.negocio_telefono || null : null;
    const whatsapp = verContacto ? f.negocio_whatsapp || null : null;
    const verDireccion = esNegocio && ve('direccion');

    return {
        perfil: {
            id: f.id,
            tipo: f.tipo_cuenta,
            nombre: nombreDe(f),
            foto: fotoDe(base, f),
            foto_portada: urlPublica(base, f.foto_portada),
            verificado: Boolean(f.correo_verificado),
            // Con las ventas ocultas, "publicados" pasa a contar solo los disponibles
            // para que el cliente no pueda deducir cuántas hubo restando.
            publicados: verVendidos ? f.publicados : f.disponibles,
            vendidos: verVendidos ? f.vendidos : 0,
            likes: ve('me_gusta') ? f.likes : 0,
            ubicacion: ve('ubicacion')
                ? esNegocio
                    ? ubicacionTexto(f.ciudad, f.sector)
                    : anuncios[0]?.ubicacion || null
                : null,
            miembroDesde: ve('miembro_desde')
                ? new Date(f.creado_en).toLocaleDateString('es-EC', { month: 'long', year: 'numeric' })
                : null,
            seguidores: ve('seguidores') ? f.seguidores : 0,
            seguidos: ve('seguidores') ? f.seguidos : 0,
            loSigues: Boolean(f.lo_sigues),
            contacto: whatsapp ? 'whatsapp' : telefono ? 'telefono' : null,
            categoria: esNegocio ? f.categoria_nombre || null : null,
            descripcion: esNegocio ? f.descripcion_breve || null : null,
            direccion: verDireccion ? f.direccion_local || null : null,
            horario: esNegocio && ve('horario') ? horarioPublico(f.horario_atencion) : [],
            entregaDomicilio: esNegocio ? Boolean(f.entrega_domicilio) : false,
            zonaCobertura: esNegocio ? f.zona_cobertura || null : null,
            telefono,
            whatsapp,
            latitud: verDireccion && f.latitud !== null ? Number(f.latitud) : null,
            longitud: verDireccion && f.longitud !== null ? Number(f.longitud) : null,
            redes: esNegocio && ve('redes') ? redesPublicas(f.redes_sociales) : [],
            // Aún no hay sistema de valoraciones.
            valoracion: null,
            numeroValoraciones: 0,
            // El cliente lo usa para no pintar secciones vacías y, al dueño, para
            // marcarle qué partes no ven los demás.
            visibilidad: privacidad,
        },
        anuncios,
        // Total de anuncios listables con el mismo filtro que la consulta.
        paginacion: infoPagina(pagina, verVendidos ? f.publicados : f.disponibles),
    };
};

// Solo los anuncios (páginas siguientes), sin volver a pedir todo el perfil.
const listarAnuncios = async ({ usuarioId, visitanteId, base, query }) => {
    validarId(usuarioId);
    const f = await perfilModel.obtenerPerfilPublico(usuarioId, null);
    if (!f) throw error('Usuario no encontrado', 404);
    const verVendidos = visibleParaVisitante(f, visitanteId).ve('vendidos');
    const pagina = paginacionDe(query);
    const filas = await perfilModel.listarAnunciosPublicos(usuarioId, pagina, !verVendidos);
    return {
        anuncios: filas.map((a) => anuncioPublico(base, a)),
        paginacion: infoPagina(pagina, verVendidos ? f.publicados : f.disponibles),
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
const listarRelacion = async ({ usuarioId, visitanteId, direccion, query, base }) => {
    validarId(usuarioId);
    const f = await perfilModel.obtenerPerfilPublico(usuarioId, null);
    if (!f) throw error('Usuario no encontrado', 404);
    if (!visibleParaVisitante(f, visitanteId).ve('seguidores')) {
        throw error('Este usuario mantiene privadas sus listas de seguidores', 403);
    }
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
