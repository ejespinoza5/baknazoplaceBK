const fs = require('fs');
const crypto = require('crypto');
const pool = require('../config/db');
const anuncioModel = require('../models/anuncioModel');
const catalogoModel = require('../models/catalogoModel');
const negocioModel = require('../models/negocioModel');
const { procesarFotoAnuncio, rutaAbsolutaDeStorageKey } = require('./imageService');
const { validarLatitud, validarLongitud } = require('../utils/validaciones');
const {
    PILARES,
    MAX_FOTOS,
    ENUMERACIONES,
    TITULO_MIN,
    TITULO_MAX,
    DESCRIPCION_MAX,
    SECTOR_MAX,
    ZONA_COBERTURA_MAX,
    PRECIO_MAX,
    LIMITE_FEED_DEFECTO,
    LIMITE_FEED_MAX,
} = require('../config/anuncios');

const error = (mensaje, status) => {
    const err = new Error(mensaje);
    err.status = status;
    return err;
};

// 422 con el mapa campo → mensaje, para pintar cada error en su input.
const errorValidacion = (errores) => {
    const err = error('Datos inválidos', 422);
    err.errores = errores;
    return err;
};

const vacio = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
const texto = (v) => (vacio(v) ? null : String(v).trim());

// ---------- Slug ----------

const slugificar = (titulo) =>
    titulo
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 120)
        .replace(/-+$/, '');

const generarSlug = (titulo) => `${slugificar(titulo) || 'anuncio'}-${crypto.randomBytes(4).toString('hex')}`;

// ---------- Validación de campos ----------

// Precio como texto exacto ("320.00") o null = "a convenir". Acepta coma decimal.
const normalizarPrecio = (valor) => {
    if (vacio(valor)) return { ok: true, valor: null };
    const t = String(valor).trim().replace(',', '.');
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(t) || Number(t) > PRECIO_MAX) return { ok: false };
    return { ok: true, valor: Number(t).toFixed(2) };
};

const validarDetalle = (pilar, detalle, errores) => {
    const d = detalle && typeof detalle === 'object' ? detalle : {};
    const enumValida = (valor, nombre) => Object.prototype.hasOwnProperty.call(ENUMERACIONES[nombre], valor);

    if (pilar === 'productos') {
        if (!enumValida(d.condicion, 'condicion')) errores['detalle.condicion'] = 'Indica si es nuevo o usado';
        return { condicion: d.condicion };
    }
    if (pilar === 'servicios') {
        if (!enumValida(d.modalidadCobro, 'modalidadCobro')) {
            errores['detalle.modalidadCobro'] = 'Indica cómo cobras el servicio';
        }
        const zona = texto(d.zonaCobertura);
        if (zona && zona.length > ZONA_COBERTURA_MAX) {
            errores['detalle.zonaCobertura'] = `Máximo ${ZONA_COBERTURA_MAX} caracteres`;
        }
        return { modalidadCobro: d.modalidadCobro, zonaCobertura: zona };
    }
    // empleo
    if (!enumValida(d.jornada, 'jornada')) errores['detalle.jornada'] = 'Indica la jornada';
    if (!enumValida(d.modalidad, 'modalidad')) errores['detalle.modalidad'] = 'Indica la modalidad';
    return { jornada: d.jornada, modalidad: d.modalidad };
};

// Valida los campos comunes presentes en 'datos'. Con parcial=true solo valida los enviados.
// Devuelve los valores normalizados (solo de los campos enviados) y llena 'errores'.
const validarCampos = async (datos, pilar, errores, parcial) => {
    const r = {};
    const enviado = (clave) => !parcial || datos[clave] !== undefined;

    if (enviado('titulo')) {
        const titulo = texto(datos.titulo);
        if (!titulo) errores.titulo = 'El título es obligatorio';
        else if (titulo.length < TITULO_MIN) errores.titulo = 'El título es muy corto';
        else if (titulo.length > TITULO_MAX) errores.titulo = `El título admite máximo ${TITULO_MAX} caracteres`;
        r.titulo = titulo;
    }

    if (enviado('descripcion')) {
        const descripcion = texto(datos.descripcion);
        if (descripcion && descripcion.length > DESCRIPCION_MAX) {
            errores.descripcion = `La descripción admite máximo ${DESCRIPCION_MAX} caracteres`;
        }
        r.descripcion = descripcion;
    }

    if (enviado('categoriaId')) {
        const id = Number(datos.categoriaId);
        const categoria = Number.isInteger(id) && id > 0 ? await catalogoModel.buscarCategoriaAnuncio(id) : null;
        if (!categoria || !categoria.activa) errores.categoriaId = 'Selecciona una categoría';
        else if (categoria.pilar !== pilar) errores.categoriaId = 'La categoría no corresponde a este tipo de anuncio';
        else r.categoriaId = id;
    }

    if (enviado('cantonCodigo')) {
        const codigo = texto(datos.cantonCodigo);
        const canton = codigo && /^\d{6}$/.test(codigo) ? await catalogoModel.buscarCanton(codigo) : null;
        if (!canton) {
            errores.cantonCodigo = 'Selecciona una ciudad';
        } else {
            r.cantonCodigo = canton.codigo;
            r.provinciaCodigo = canton.provincia_codigo;
        }
    }

    if (enviado('sector')) {
        const sector = texto(datos.sector);
        if (sector && sector.length > SECTOR_MAX) errores.sector = `Máximo ${SECTOR_MAX} caracteres`;
        r.sector = sector;
    }

    if (enviado('precio')) {
        const precio = normalizarPrecio(datos.precio);
        if (!precio.ok) errores.precio = 'El precio no es válido';
        else r.precio = precio.valor;
    }

    if (enviado('latitud') || enviado('longitud')) {
        const sinLat = vacio(datos.latitud);
        const sinLng = vacio(datos.longitud);
        if (sinLat && sinLng) {
            r.latitud = null;
            r.longitud = null;
        } else if (sinLat !== sinLng) {
            errores.ubicacion = 'Envía latitud y longitud juntas';
        } else if (!validarLatitud(datos.latitud) || !validarLongitud(datos.longitud)) {
            errores.ubicacion = 'Coordenadas inválidas';
        } else {
            r.latitud = Number(datos.latitud);
            r.longitud = Number(datos.longitud);
        }
    }

    return r;
};

// ---------- Fotos ----------

const borrarArchivos = (storageKeys) => {
    for (const key of storageKeys) {
        const abs = rutaAbsolutaDeStorageKey(key);
        if (abs) fs.promises.unlink(abs).catch(() => {});
    }
};

// Comprime y guarda las fotos. Si alguna falla, borra las ya guardadas.
const procesarFotos = async (archivos) => {
    const fotos = [];
    try {
        for (const archivo of archivos) {
            fotos.push(await procesarFotoAnuncio(archivo.buffer));
        }
        return fotos;
    } catch (e) {
        borrarArchivos(fotos.map((f) => f.storageKey));
        throw errorValidacion({ fotos: 'Una de las fotos no es una imagen válida' });
    }
};

// ---------- Serialización ----------

const urlPublica = (base, ruta) => {
    if (!ruta) return null;
    if (/^https?:\/\//i.test(ruta)) return ruta;
    return `${base}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
};

const urlFoto = (base, storageKey) => urlPublica(base, `/uploads/${storageKey}`);

const detalleDe = (fila) => {
    if (fila.pilar === 'productos') return { condicion: fila.condicion };
    if (fila.pilar === 'servicios') return { modalidadCobro: fila.modalidad_cobro, zonaCobertura: fila.zona_cobertura };
    return { jornada: fila.jornada, modalidad: fila.modalidad };
};

const autorDe = (fila, base) => ({
    nombre: fila.negocio_nombre || fila.autor_nombres,
    foto: urlPublica(base, fila.negocio_nombre ? fila.negocio_logo : fila.autor_foto),
    verificado: fila.autor_verificado,
    esNegocio: Boolean(fila.autor_negocio_id),
});

const portadaDe = (fila, base) =>
    fila.portada_key ? { url: urlFoto(base, fila.portada_key), ancho: fila.portada_ancho, alto: fila.portada_alto } : null;

const categoriaDe = (fila) => ({ id: fila.categoria_id, slug: fila.categoria_slug, nombre: fila.categoria_nombre });

// Tarjeta del feed. Las coordenadas exactas nunca se exponen: solo la distancia.
const aItemFeed = (fila, base) => ({
    id: Number(fila.id),
    slug: fila.slug,
    pilar: fila.pilar,
    titulo: fila.titulo,
    precio: fila.precio,
    moneda: fila.moneda,
    ubicacion: fila.canton_nombre,
    provincia: fila.provincia_nombre,
    sector: fila.sector,
    distanciaKm: fila.distancia_km === null || fila.distancia_km === undefined ? null : Math.round(fila.distancia_km * 10) / 10,
    portada: portadaDe(fila, base),
    categoria: categoriaDe(fila),
    detalle: detalleDe(fila),
    publicadoEn: fila.publicado_en,
    autor: autorDe(fila, base),
});

// Anuncio completo (detalle, respuesta de crear/editar).
const aAnuncio = (fila, fotos, base, esMio) => {
    const anuncio = {
        id: Number(fila.id),
        slug: fila.slug,
        pilar: fila.pilar,
        titulo: fila.titulo,
        descripcion: fila.descripcion,
        precio: fila.precio,
        moneda: fila.moneda,
        ubicacion: fila.canton_nombre,
        provincia: fila.provincia_nombre,
        cantonCodigo: fila.canton_codigo,
        provinciaCodigo: fila.provincia_codigo,
        sector: fila.sector,
        categoria: categoriaDe(fila),
        portada: portadaDe(fila, base),
        fotos: fotos.map((f) => ({ id: Number(f.id), url: urlFoto(base, f.storage_key), ancho: f.ancho, alto: f.alto, orden: f.orden })),
        detalle: detalleDe(fila),
        estado: fila.estado,
        vistas: fila.vistas,
        contactos: fila.contactos,
        publicadoEn: fila.publicado_en,
        creadoEn: fila.creado_en,
        actualizadoEn: fila.actualizado_en,
        autor: autorDe(fila, base),
        esMio: Boolean(esMio),
    };
    if (fila.negocio_whatsapp) anuncio.autor.whatsapp = fila.negocio_whatsapp;
    if (esMio) {
        // Solo el dueño ve sus coordenadas y el motivo de rechazo.
        anuncio.latitud = fila.latitud === null ? null : Number(fila.latitud);
        anuncio.longitud = fila.longitud === null ? null : Number(fila.longitud);
        anuncio.notasModeracion = fila.notas_moderacion;
    }
    return anuncio;
};

const cargarCompleto = async (id, base, esMio, client) => {
    const fila = await anuncioModel.buscarPorId(id, client);
    const fotos = await anuncioModel.listarFotos(id, client);
    return aAnuncio(fila, fotos, base, esMio);
};

const respuestaCreacion = (anuncio) => ({
    id: anuncio.id,
    slug: anuncio.slug,
    estado: anuncio.estado,
    publicadoEn: anuncio.publicadoEn,
    anuncio,
});

// ---------- Casos de uso ----------

const crear = async ({ usuario, datos, archivos, idempotencyKey, base }) => {
    if (idempotencyKey !== null && (idempotencyKey.length < 8 || idempotencyKey.length > 100)) {
        throw error('Idempotency-Key inválido', 400);
    }

    // Reintento de una publicación que ya se hizo: se responde lo mismo sin procesar nada.
    if (idempotencyKey) {
        const existente = await anuncioModel.buscarIdempotencia(usuario.id, idempotencyKey);
        if (existente) return { repetido: true, ...respuestaCreacion(await cargarCompleto(existente, base, true)) };
    }

    const errores = {};
    const pilar = datos.pilar;
    if (!PILARES.includes(pilar)) {
        throw errorValidacion({ pilar: 'Tipo de anuncio inválido' });
    }

    const campos = await validarCampos(datos, pilar, errores, false);
    const detalle = validarDetalle(pilar, datos.detalle, errores);
    if (pilar === 'productos' && archivos.length === 0) errores.fotos = 'Se requiere al menos una foto';
    if (archivos.length > MAX_FOTOS) errores.fotos = `Máximo ${MAX_FOTOS} fotos por anuncio`;
    if (Object.keys(errores).length > 0) throw errorValidacion(errores);

    // Las cuentas de negocio publican en nombre de su negocio.
    const negocio = usuario.tipo_cuenta === 'NEGOCIO' ? await negocioModel.buscarPorUsuario(usuario.id) : null;

    const fotos = await procesarFotos(archivos);

    const client = await pool.connect();
    let anuncioId;
    try {
        await client.query('BEGIN');
        anuncioId = await anuncioModel.insertar(client, {
            ...campos,
            slug: generarSlug(campos.titulo),
            pilar,
            autorUsuarioId: usuario.id,
            autorNegocioId: negocio ? negocio.id : null,
        });
        await anuncioModel.guardarDetalle(client, pilar, anuncioId, detalle);
        for (let i = 0; i < fotos.length; i++) {
            await anuncioModel.insertarFoto(client, anuncioId, fotos[i], i);
        }

        if (idempotencyKey) {
            const registrada = await anuncioModel.registrarIdempotencia(client, usuario.id, idempotencyKey, anuncioId);
            if (!registrada) {
                // Otra petición con la misma clave ganó la carrera: se descarta esta y se devuelve aquella.
                await client.query('ROLLBACK');
                borrarArchivos(fotos.map((f) => f.storageKey));
                const ganador = await anuncioModel.buscarIdempotencia(usuario.id, idempotencyKey);
                return { repetido: true, ...respuestaCreacion(await cargarCompleto(ganador, base, true)) };
            }
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        borrarArchivos(fotos.map((f) => f.storageKey));
        throw e;
    } finally {
        client.release();
    }

    return { repetido: false, ...respuestaCreacion(await cargarCompleto(anuncioId, base, true)) };
};

// Acepta id numérico o slug.
const obtener = async ({ idOSlug, usuarioId, base }) => {
    const fila = /^\d+$/.test(idOSlug)
        ? await anuncioModel.buscarPorId(idOSlug)
        : await anuncioModel.buscarPorSlug(idOSlug);

    if (!fila || fila.eliminado_en) throw error('Anuncio no encontrado', 404);

    const esMio = Boolean(usuarioId) && fila.autor_usuario_id === usuarioId;
    const visible = fila.estado === 'PUBLICADO' && (!fila.expira_en || new Date(fila.expira_en) > new Date());
    if (!visible && !esMio) throw error('Anuncio no encontrado', 404);

    if (visible && !esMio) {
        anuncioModel.incrementarVistas(fila.id).catch(() => {});
    }

    const fotos = await anuncioModel.listarFotos(fila.id);
    return aAnuncio(fila, fotos, base, esMio);
};

// ---------- Feed ----------

const REGEX_TIMESTAMP_PG = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2}){0,2}|Z)?$/;

const decodificarCursor = (cursor, orden) => {
    try {
        const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        const idValido = /^\d+$/.test(String(c.id));
        if (orden === 'cercanos' && idValido && typeof c.d === 'number' && Number.isFinite(c.d)) return c;
        if (orden === 'recientes' && idValido && typeof c.p === 'string' && !Number.isNaN(Date.parse(c.p))) return c;
        // 'mios': creado_en tal como lo imprime Postgres (con microsegundos y zona horaria).
        if (orden === 'mios' && idValido && typeof c.c === 'string' && REGEX_TIMESTAMP_PG.test(c.c)) return c;
    } catch (e) {
        // cursor corrupto
    }
    throw error('Cursor inválido', 400);
};

const codificarCursor = (fila, orden) => {
    let c;
    if (orden === 'cercanos') c = { d: fila.distancia_km, id: String(fila.id) };
    else if (orden === 'mios') c = { c: fila.creado_en_exacto, id: String(fila.id) };
    else c = { p: new Date(fila.publicado_en).toISOString(), id: String(fila.id) };
    return Buffer.from(JSON.stringify(c)).toString('base64url');
};

const numeroOpcional = (valor, nombre, { min = -Infinity, max = Infinity } = {}) => {
    if (vacio(valor)) return null;
    const n = Number(valor);
    if (Number.isNaN(n) || n < min || n > max) throw error(`Parámetro '${nombre}' inválido`, 400);
    return n;
};

// 1..LIMITE_FEED_MAX; 0 o texto → 400, valores grandes se recortan.
const limiteDePagina = (valor) =>
    Math.min(
        Math.max(Math.trunc(numeroOpcional(valor, 'limite', { min: 1 }) || LIMITE_FEED_DEFECTO), 1),
        LIMITE_FEED_MAX
    );

// Truco de hayMas: el modelo pide limite + 1 filas; si sobra una, hay otra página.
const paginar = (filas, limite, orden) => {
    const hayMas = filas.length > limite;
    const pagina = hayMas ? filas.slice(0, limite) : filas;
    return {
        filas: pagina,
        pagina: {
            siguienteCursor: hayMas ? codificarCursor(pagina[pagina.length - 1], orden) : null,
            hayMas,
        },
    };
};

const listarFeed = async ({ query, base }) => {
    const orden = query.orden || 'recientes';
    if (!['recientes', 'cercanos'].includes(orden)) throw error("Parámetro 'orden' inválido", 400);

    if (query.pilar && !PILARES.includes(query.pilar)) throw error("Parámetro 'pilar' inválido", 400);
    if (query.canton && !/^\d{6}$/.test(query.canton)) throw error("Parámetro 'canton' inválido", 400);
    if (query.provincia && !/^\d{2}$/.test(query.provincia)) throw error("Parámetro 'provincia' inválido", 400);

    const categoriaId = numeroOpcional(query.categoria, 'categoria', { min: 1 });
    if (categoriaId !== null && !Number.isInteger(categoriaId)) throw error("Parámetro 'categoria' inválido", 400);

    const lat = numeroOpcional(query.lat, 'lat', { min: -90, max: 90 });
    const lng = numeroOpcional(query.lng, 'lng', { min: -180, max: 180 });
    if ((lat === null) !== (lng === null)) throw error('Envía lat y lng juntos', 400);
    if (orden === 'cercanos' && lat === null) throw error("El orden 'cercanos' requiere lat y lng", 400);
    const radioKm = numeroOpcional(query.radioKm, 'radioKm', { min: 0.1, max: 1000 });
    if (radioKm !== null && lat === null) throw error("'radioKm' requiere lat y lng", 400);

    const limite = limiteDePagina(query.limite);

    const q = texto(query.q);
    const filas = await anuncioModel.feed({
        pilar: query.pilar || null,
        categoriaId,
        cantonCodigo: query.canton || null,
        provinciaCodigo: query.provincia || null,
        q: q ? q.slice(0, 100) : null,
        precioMin: numeroOpcional(query.precioMin, 'precioMin', { min: 0 }),
        precioMax: numeroOpcional(query.precioMax, 'precioMax', { min: 0 }),
        lat,
        lng,
        radioKm,
        orden,
        cursor: query.cursor ? decodificarCursor(query.cursor, orden) : null,
        limite,
    });

    const { filas: pagina, pagina: infoPagina } = paginar(filas, limite, orden);
    return {
        items: pagina.map((f) => aItemFeed(f, base)),
        pagina: infoPagina,
    };
};

const listarMios = async ({ usuarioId, query, base }) => {
    const estado = query.estado || null;
    const estados = ['BORRADOR', 'PUBLICADO', 'PAUSADO', 'RECHAZADO'];
    if (estado && !estados.includes(estado)) throw error("Parámetro 'estado' inválido", 400);

    const limite = limiteDePagina(query.limite);
    const filas = await anuncioModel.listarPorAutor({
        usuarioId,
        estado,
        cursor: query.cursor ? decodificarCursor(query.cursor, 'mios') : null,
        limite,
    });

    const { filas: pagina, pagina: infoPagina } = paginar(filas, limite, 'mios');
    return {
        items: pagina.map((f) => ({
            ...aItemFeed(f, base),
            estado: f.estado,
            vistas: f.vistas,
            contactos: f.contactos,
            creadoEn: f.creado_en,
            notasModeracion: f.notas_moderacion,
        })),
        pagina: infoPagina,
    };
};

// ---------- Edición ----------

// Carga el anuncio y verifica que sea del usuario. Los eliminados no existen para nadie.
const anuncioPropio = async (id, usuarioId, client) => {
    if (!/^\d+$/.test(String(id))) throw error('Anuncio no encontrado', 404);
    const anuncio = client
        ? await anuncioModel.bloquearParaEditar(client, id)
        : await anuncioModel.buscarPorId(id);
    if (!anuncio || anuncio.eliminado_en) throw error('Anuncio no encontrado', 404);
    if (anuncio.autor_usuario_id !== usuarioId) throw error('No puedes modificar este anuncio', 403);
    return anuncio;
};

const actualizar = async ({ id, usuarioId, datos, archivos, base }) => {
    const actual = await anuncioPropio(id, usuarioId);
    const pilar = actual.pilar;
    const errores = {};

    if (datos.pilar !== undefined && datos.pilar !== pilar) errores.pilar = 'El tipo de anuncio no se puede cambiar';

    const cambios = await validarCampos(datos, pilar, errores, true);

    // Si cambia la categoría o el detalle, se valida el detalle completo (lo actual + lo enviado).
    let detalle = null;
    if (datos.detalle !== undefined) {
        const detalleActual = detalleDe(actual);
        detalle = validarDetalle(pilar, { ...detalleActual, ...(datos.detalle || {}) }, errores);
    }

    if (datos.estado !== undefined) {
        const permitidos = { PUBLICADO: ['PAUSADO', 'BORRADOR'], PAUSADO: ['PUBLICADO'] };
        if (!permitidos[datos.estado]) {
            errores.estado = 'Solo puedes publicar o pausar el anuncio';
        } else if (datos.estado !== actual.estado && !permitidos[datos.estado].includes(actual.estado)) {
            errores.estado = `No se puede pasar de ${actual.estado} a ${datos.estado}`;
        } else if (datos.estado !== actual.estado) {
            cambios.estado = datos.estado;
            if (datos.estado === 'PUBLICADO' && !actual.publicado_en) cambios.publicadoEn = new Date();
        }
    }

    // Fotos: 'fotosConservar' = ids en el nuevo orden (la primera es la portada).
    // Las no incluidas se borran; las nuevas se agregan al final.
    const fotosActuales = await anuncioModel.listarFotos(actual.id);
    let conservar = fotosActuales.map((f) => String(f.id));
    if (datos.fotosConservar !== undefined) {
        const ids = Array.isArray(datos.fotosConservar) ? datos.fotosConservar.map(String) : null;
        const validos = new Set(conservar);
        if (!ids || ids.some((i) => !validos.has(i)) || new Set(ids).size !== ids.length) {
            errores.fotos = 'La lista de fotos a conservar no es válida';
        } else {
            conservar = ids;
        }
    }
    const totalFotos = conservar.length + archivos.length;
    if (totalFotos > MAX_FOTOS) errores.fotos = `Máximo ${MAX_FOTOS} fotos por anuncio`;
    if (pilar === 'productos' && totalFotos === 0) errores.fotos = 'Se requiere al menos una foto';

    if (Object.keys(errores).length > 0) throw errorValidacion(errores);

    const nuevas = await procesarFotos(archivos);
    const aBorrar = fotosActuales.filter((f) => !conservar.includes(String(f.id)));

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await anuncioPropio(actual.id, usuarioId, client); // bloquea la fila frente a ediciones simultáneas
        await anuncioModel.actualizar(client, actual.id, cambios);
        if (detalle) await anuncioModel.guardarDetalle(client, pilar, actual.id, detalle);

        await anuncioModel.eliminarFotos(client, actual.id, aBorrar.map((f) => f.id));
        await anuncioModel.reordenarFotos(client, actual.id, conservar);
        for (let i = 0; i < nuevas.length; i++) {
            await anuncioModel.insertarFoto(client, actual.id, nuevas[i], conservar.length + i);
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        borrarArchivos(nuevas.map((f) => f.storageKey));
        throw e;
    } finally {
        client.release();
    }

    // Los archivos de las fotos quitadas se borran solo después de confirmar la transacción.
    borrarArchivos(aBorrar.map((f) => f.storage_key));

    return cargarCompleto(actual.id, base, true);
};

// Soft delete: el anuncio y sus fotos se conservan (reportes, auditoría).
const eliminar = async ({ id, usuarioId }) => {
    await anuncioPropio(id, usuarioId);
    await anuncioModel.eliminarSoft(id);
};

const registrarContacto = async ({ id, usuarioId }) => {
    if (!/^\d+$/.test(String(id))) throw error('Anuncio no encontrado', 404);
    const fila = await anuncioModel.buscarPorId(id);
    if (!fila) throw error('Anuncio no encontrado', 404);
    if (usuarioId && fila.autor_usuario_id === usuarioId) return; // el dueño no cuenta
    const ok = await anuncioModel.incrementarContactos(id);
    if (!ok) throw error('Anuncio no encontrado', 404);
};

module.exports = {
    crear,
    obtener,
    listarFeed,
    listarMios,
    actualizar,
    eliminar,
    registrarContacto,
};
