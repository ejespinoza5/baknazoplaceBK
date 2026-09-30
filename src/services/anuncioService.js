const fs = require('fs');
const crypto = require('crypto');
const pool = require('../config/db');
const anuncioModel = require('../models/anuncioModel');
const catalogoModel = require('../models/catalogoModel');
const negocioModel = require('../models/negocioModel');
const postulacionService = require('./postulacionService');
const { procesarFotoAnuncio, rutaAbsolutaDeStorageKey } = require('./imageService');
const { validarLatitud, validarLongitud } = require('../utils/validaciones');
const { resolverContacto, telefonoLegible, enlaceWhatsapp } = require('../utils/telefono');
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

    // Boolean real: viaja dentro del JSON de 'datos', así que no pasa por la
    // conversión a texto de multipart. Al crear, si no viene, es false.
    if (enviado('mostrarTelefono')) {
        const valor = datos.mostrarTelefono === undefined ? false : datos.mostrarTelefono;
        if (typeof valor !== 'boolean') errores.mostrarTelefono = 'Debe ser true o false';
        else r.mostrarTelefono = valor;
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

// Ningún número viaja aquí: `whatsapp` se mantiene por compatibilidad, siempre
// null. La única forma de obtener un teléfono es POST /api/anuncios/:id/contacto.
const autorDe = (fila, base) => ({
    // Sin este id no se puede abrir el perfil de quien publicó: es lo que viaja
    // en la URL (/perfil/:id) y lo único que permite ir de un anuncio a los
    // demás de la misma persona.
    id: fila.autor_usuario_id,
    nombre: fila.negocio_nombre || fila.autor_nombres,
    foto: urlPublica(base, fila.negocio_nombre ? fila.negocio_logo : fila.autor_foto),
    verificado: fila.autor_verificado,
    esNegocio: Boolean(fila.autor_negocio_id),
    whatsapp: null,
});

const estaVisible = (fila) =>
    fila.estado === 'PUBLICADO' && !fila.eliminado_en && (!fila.expira_en || new Date(fila.expira_en) > new Date());

const contactoDe = (fila) =>
    resolverContacto({
        usuarioTelefono: fila.autor_telefono,
        negocioTelefono: fila.negocio_telefono,
        negocioWhatsapp: fila.negocio_whatsapp,
    });

// mostrarTelefono = lo que eligió el dueño (columna del anuncio).
// telefonoVisible = si un desconocido puede pedir el número ahora mismo.
// Un vendido ya no se vende: no se ofrece el número aunque el dueño lo tenga activo.
const camposTelefono = (fila) => ({
    mostrarTelefono: fila.mostrar_telefono,
    telefonoVisible: fila.mostrar_telefono && !fila.vendido && estaVisible(fila) && contactoDe(fila) !== null,
});

// meGusta depende de quién mira: lo calcula quien llama (false sin sesión).
const camposVenta = (fila, meGusta) => ({
    vendido: fila.vendido,
    vendidoEn: fila.vendido_en,
    likes: Number(fila.likes),
    meGusta: Boolean(meGusta),
});

const portadaDe = (fila, base) =>
    fila.portada_key ? { url: urlFoto(base, fila.portada_key), ancho: fila.portada_ancho, alto: fila.portada_alto } : null;

const categoriaDe = (fila) => ({ id: fila.categoria_id, slug: fila.categoria_slug, nombre: fila.categoria_nombre });

// Tarjeta del feed. Las coordenadas exactas nunca se exponen: solo la distancia.
const aItemFeed = (fila, base, meGusta) => ({
    id: Number(fila.id),
    slug: fila.slug,
    pilar: fila.pilar,
    titulo: fila.titulo,
    // El listado lleva la descripción, las fotos y los contadores porque la vista
    // de lista muestra la publicación completa: sin esto, entrar en lista
    // obligaría a abrir el anuncio uno por uno para saber qué vendía.
    descripcion: fila.descripcion,
    fotos: (fila.fotos || []).map((f) => ({
        id: Number(f.id),
        url: urlFoto(base, f.storage_key),
        ancho: f.ancho,
        alto: f.alto,
        orden: f.orden,
    })),
    vistas: Number(fila.vistas),
    contactos: Number(fila.contactos),
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
    ...camposVenta(fila, meGusta),
    ...camposTelefono(fila),
    autor: autorDe(fila, base),
});

// Anuncio completo (detalle, respuesta de crear/editar).
const aAnuncio = (fila, fotos, base, esMio, meGusta = false) => {
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
        ...camposVenta(fila, meGusta),
        ...camposTelefono(fila),
        autor: autorDe(fila, base),
        esMio: Boolean(esMio),
    };
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
const obtener = async ({ idOSlug, usuarioId, visitante, base }) => {
    const fila = /^\d+$/.test(idOSlug)
        ? await anuncioModel.buscarPorId(idOSlug)
        : await anuncioModel.buscarPorSlug(idOSlug);

    if (!fila || fila.eliminado_en) throw error('Anuncio no encontrado', 404);

    const esMio = Boolean(usuarioId) && fila.autor_usuario_id === usuarioId;
    const visible = estaVisible(fila);
    if (!visible && !esMio) throw error('Anuncio no encontrado', 404);

    // Abrir la ficha es una vista, pero solo una por persona cada 24 h: recargar
    // no infla el número. La del dueño no cuenta (lo filtra el modelo).
    if (visible && !esMio && visitante) {
        anuncioModel.registrarVistas([fila.id], visitante, usuarioId).catch(() => {});
    }

    const [fotos, conLike, guardados, postulacion] = await Promise.all([
        anuncioModel.listarFotos(fila.id),
        anuncioModel.idsConLike(usuarioId, [fila.id]),
        anuncioModel.idsGuardados(usuarioId, [fila.id]),
        // Solo empleo: si quien mira ya se postuló, o cuántas tiene el dueño.
        postulacionService.infoParaAnuncio(fila, usuarioId),
    ]);
    return {
        ...aAnuncio(fila, fotos, base, esMio, conLike.has(String(fila.id))),
        guardado: guardados.has(String(fila.id)),
        ...postulacion,
    };
};

// ---------- Feed ----------

const REGEX_TIMESTAMP_PG = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2}){0,2}|Z)?$/;

const decodificarCursor = (cursor, orden) => {
    try {
        const c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
        const idValido = /^\d+$/.test(String(c.id));
        if (orden === 'cercanos' && idValido && typeof c.d === 'number' && Number.isFinite(c.d)) return c;
        if (orden === 'recientes' && idValido && typeof c.p === 'string' && !Number.isNaN(Date.parse(c.p))) return c;
        // Precio: se guarda como texto para no perder los decimales de NUMERIC.
        if ((orden === 'precio_asc' || orden === 'precio_desc') && idValido && /^-?\d+(\.\d+)?$/.test(String(c.v))) return c;
        // 'mios': creado_en tal como lo imprime Postgres (con microsegundos y zona horaria).
        if ((orden === 'mios' || orden === 'guardados') && idValido && typeof c.c === 'string' && REGEX_TIMESTAMP_PG.test(c.c)) return c;
    } catch (e) {
        // cursor corrupto
    }
    throw error('Cursor inválido', 400);
};

const codificarCursor = (fila, orden) => {
    let c;
    if (orden === 'cercanos') c = { d: fila.distancia_km, id: String(fila.id) };
    else if (orden === 'precio_asc' || orden === 'precio_desc') c = { v: String(fila.precio_orden), id: String(fila.id) };
    else if (orden === 'mios') c = { c: fila.creado_en_exacto, id: String(fila.id) };
    else if (orden === 'guardados') c = { c: fila.guardado_en_exacto, id: String(fila.id) };
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

const listarFeed = async ({ query, usuarioId, base }) => {
    const orden = query.orden || 'recientes';
    if (!['recientes', 'cercanos', 'precio_asc', 'precio_desc'].includes(orden)) {
        throw error("Parámetro 'orden' inválido", 400);
    }

    // Filtros del detalle de cada pilar: solo valores de las enumeraciones.
    const enumOpcional = (valor, nombre, lista) => {
        if (vacio(valor)) return null;
        if (!Object.prototype.hasOwnProperty.call(lista, valor)) throw error(`Parámetro '${nombre}' inválido`, 400);
        return valor;
    };
    const condicion = enumOpcional(query.condicion, 'condicion', ENUMERACIONES.condicion);
    const modalidadCobro = enumOpcional(query.modalidadCobro, 'modalidadCobro', ENUMERACIONES.modalidadCobro);
    const jornada = enumOpcional(query.jornada, 'jornada', ENUMERACIONES.jornada);
    const modalidad = enumOpcional(query.modalidad, 'modalidad', ENUMERACIONES.modalidad);

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
        condicion,
        modalidadCobro,
        jornada,
        modalidad,
        conFoto: query.conFoto === 'true' || query.conFoto === '1',
        lat,
        lng,
        radioKm,
        orden,
        cursor: query.cursor ? decodificarCursor(query.cursor, orden) : null,
        limite,
    });

    const { filas: pagina, pagina: infoPagina } = paginar(filas, limite, orden);
    const ids = pagina.map((f) => f.id);
    const [conLike, guardados] = await Promise.all([
        anuncioModel.idsConLike(usuarioId, ids),
        anuncioModel.idsGuardados(usuarioId, ids),
    ]);
    return {
        // El Feed lleva `esMio` para que la lista no le ofrezca al dueño un chat
        // con su propio anuncio. Sin sesión sale false, que es lo mismo que no
        // saberlo: en ese caso la lista tampoco tiene un botón de chat que
        // aparezca solo en tu caso.
        items: pagina.map((f) => ({
            ...aItemFeed(f, base, conLike.has(String(f.id))),
            esMio: Boolean(usuarioId) && f.autor_usuario_id === usuarioId,
            guardado: guardados.has(String(f.id)),
        })),
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
    // Nadie puede dar me gusta a lo suyo, así que meGusta aquí es siempre false.
    return {
        items: pagina.map((f) => ({
            ...aItemFeed(f, base, false),
            esMio: true,
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

    if (datos.vendido !== undefined) {
        if (typeof datos.vendido !== 'boolean') {
            errores.vendido = 'Debe ser true o false';
        } else if (datos.vendido !== actual.vendido) {
            cambios.vendido = datos.vendido;
            // El CHECK de la tabla exige que vayan juntos; además es el único
            // registro de cuándo se cerró la venta.
            cambios.vendidoEn = datos.vendido ? new Date() : null;
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

// Reveal del teléfono: el único punto de la API que devuelve un número.
// "No hay número" es una respuesta 200 con disponible: false, no un error.
const revelarContacto = async ({ id, usuarioId }) => {
    if (!/^\d+$/.test(String(id))) throw error('Anuncio no encontrado', 404);
    const fila = await anuncioModel.buscarPorId(id);
    if (!fila || fila.eliminado_en) throw error('Anuncio no encontrado', 404);

    if (fila.autor_usuario_id === usuarioId) return { disponible: false, motivo: 'ES_PROPIO' };

    // Apagado por el dueño, sin número, o anuncio pausado/no publicado.
    // Sin '!fila.vendido' el botón desaparecería pero la llamada directa seguiría
    // entregando el número.
    const contacto = fila.mostrar_telefono && !fila.vendido && estaVisible(fila) ? contactoDe(fila) : null;
    if (!contacto) return { disponible: false, motivo: 'SIN_NUMERO' };

    const contado = await anuncioModel.registrarContacto(fila.id, usuarioId);

    return {
        disponible: true,
        telefono: contacto.telefono,
        telefonoLegible: telefonoLegible(contacto.telefono),
        whatsapp: contacto.whatsapp,
        enlaceWhatsapp: enlaceWhatsapp(contacto.whatsapp, fila.titulo),
        origen: contacto.origen,
        contado,
    };
};

// ---------- Me gusta ----------

// Dar y quitar responden lo mismo: { meGusta, likes }, para que el cliente pinte
// el pulgar y el número sin adivinar ninguno de los dos.
const darLike = async ({ id, usuarioId }) => {
    if (!/^\d+$/.test(String(id))) throw error('Anuncio no encontrado', 404);
    const fila = await anuncioModel.buscarPorId(id);
    // Un pausado o no publicado no existe para quien no es el dueño (como en el detalle).
    if (!fila || !estaVisible(fila)) throw error('Anuncio no encontrado', 404);
    if (fila.autor_usuario_id === usuarioId) throw error('No puedes dar me gusta a tu propio anuncio', 403);
    if (fila.vendido) throw error('Este anuncio ya se vendió', 403);

    await anuncioModel.darLike(fila.id, usuarioId);
    return anuncioModel.estadoLike(fila.id, usuarioId);
};

// Quitar se permite aunque el anuncio ya se haya vendido o pausado: retirar un
// like propio nunca debería fallar mientras el anuncio exista.
const quitarLike = async ({ id, usuarioId }) => {
    if (!/^\d+$/.test(String(id))) throw error('Anuncio no encontrado', 404);
    const fila = await anuncioModel.buscarPorId(id);
    if (!fila || fila.eliminado_en) throw error('Anuncio no encontrado', 404);

    await anuncioModel.quitarLike(fila.id, usuarioId);
    return anuncioModel.estadoLike(fila.id, usuarioId);
};

// ---------- Guardados ----------

// Guardar solo lo que se puede ver. Quitar, siempre (aunque ya se haya vendido).
const guardar = async ({ id, usuarioId }) => {
    if (!/^\d+$/.test(String(id))) throw error('Anuncio no encontrado', 404);
    const fila = await anuncioModel.buscarPorId(id);
    if (!fila || !estaVisible(fila)) throw error('Anuncio no encontrado', 404);
    await anuncioModel.guardar(fila.id, usuarioId);
    return { guardado: true };
};

const quitarGuardado = async ({ id, usuarioId }) => {
    if (!/^\d+$/.test(String(id))) throw error('Anuncio no encontrado', 404);
    await anuncioModel.quitarGuardado(id, usuarioId);
    return { guardado: false };
};

// Incluye los vendidos y pausados: quien los guardó tiene que enterarse de que
// ya no están disponibles, no verlos desaparecer sin explicación.
const listarGuardados = async ({ usuarioId, query, base }) => {
    const limite = limiteDePagina(query.limite);
    const filas = await anuncioModel.listarGuardados({
        usuarioId,
        cursor: query.cursor ? decodificarCursor(query.cursor, 'guardados') : null,
        limite,
    });
    const { filas: pagina, pagina: infoPagina } = paginar(filas, limite, 'guardados');
    const conLike = await anuncioModel.idsConLike(usuarioId, pagina.map((f) => f.id));
    return {
        items: pagina.map((f) => ({
            ...aItemFeed(f, base, conLike.has(String(f.id))),
            esMio: f.autor_usuario_id === usuarioId,
            guardado: true,
            guardadoEn: f.guardado_en,
            // 'disponible' resume lo que importa a quien guardó: si todavía se puede comprar.
            disponible: estaVisible(f) && !f.vendido,
            estado: f.estado,
        })),
        pagina: infoPagina,
    };
};

// ---------- Vistas ----------

// POST /api/anuncios/vistas { ids }: las publicaciones que alguien vio en la
// lista (sin abrirlas). Máximo 50 por llamada; cada una cuenta una vez al día.
const registrarVistas = async ({ ids, visitante, usuarioId }) => {
    if (!Array.isArray(ids)) throw error("'ids' debe ser una lista", 400);
    const limpios = [...new Set(ids.map(String).filter((x) => /^\d{1,18}$/.test(x)))].slice(0, 50);
    const sumadas = await anuncioModel.registrarVistas(limpios, visitante, usuarioId);
    return { registradas: sumadas };
};

module.exports = {
    guardar,
    quitarGuardado,
    listarGuardados,
    registrarVistas,
    crear,
    obtener,
    listarFeed,
    listarMios,
    actualizar,
    eliminar,
    revelarContacto,
    darLike,
    quitarLike,
};
