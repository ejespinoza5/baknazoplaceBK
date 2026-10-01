const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../config/env');
const anuncioModel = require('../models/anuncioModel');
const usuarioModel = require('../models/usuarioModel');
const postulacionModel = require('../models/postulacionModel');
const emailService = require('./emailService');
const { normalizarTelefono } = require('../utils/telefono');

const ESTADOS = ['NUEVA', 'VISTA', 'PRESELECCIONADA', 'DESCARTADA', 'CONTRATADA'];
const MENSAJE_MAX = 1500;
const NOTA_MAX = 1000;

const error = (mensaje, status) => {
    const err = new Error(mensaje);
    err.status = status;
    return err;
};

const errorValidacion = (errores) => {
    const err = new Error('Datos inválidos');
    err.status = 422;
    err.errores = errores;
    return err;
};

const entero = (valor, defecto, min, max) => {
    const n = Number.parseInt(valor, 10);
    if (Number.isNaN(n)) return defecto;
    return Math.min(Math.max(n, min), max);
};

const urlPublica = (base, ruta) => {
    if (!ruta) return null;
    if (/^https?:\/\//i.test(ruta)) return ruta;
    return `${base}${ruta.startsWith('/') ? '' : '/'}${ruta}`;
};

const rutaCv = (cvKey) => {
    // cvKey siempre la genera el servidor, pero se comprueba igual que no se
    // salga de la carpeta privada.
    const absoluta = path.resolve(env.privadoDir, cvKey);
    if (!absoluta.startsWith(path.resolve(env.privadoDir) + path.sep)) throw error('Ruta de archivo inválida', 400);
    return absoluta;
};

// Nombre de archivo seguro para la descarga: sin rutas ni caracteres raros.
const nombreSeguro = (original) => {
    const base = String(original || 'hoja-de-vida.pdf')
        .replace(/[/\\?%*:|"<>\r\n]/g, '')
        .trim()
        .slice(0, 150);
    return /\.pdf$/i.test(base) ? base : `${base || 'hoja-de-vida'}.pdf`;
};

const nombrePersona = (nombres, apellidos) => [nombres, apellidos].filter(Boolean).join(' ').trim();

// Solo los negocios publican vacantes, así que solo ellos gestionan candidatos.
const exigirNegocio = (tipoCuenta) => {
    if (tipoCuenta !== 'NEGOCIO') throw error('Solo las cuentas de negocio gestionan vacantes', 403);
};

// Lo que ve el dueño de la vacante.
const aRecibida = (f, base) => ({
    id: Number(f.id),
    estado: f.estado,
    mensaje: f.mensaje,
    telefono: f.telefono,
    notaInterna: f.nota_interna,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
    cv: { nombre: f.cv_nombre, bytes: f.cv_bytes },
    anuncio: { id: Number(f.anuncio_id), titulo: f.anuncio_titulo },
    postulante: {
        id: f.postulante_id,
        nombre: nombrePersona(f.postulante_nombres, f.postulante_apellidos),
        foto: urlPublica(base, f.postulante_foto),
        // Al postularse, la persona acepta que el empleador la contacte.
        correo: f.postulante_correo,
    },
});

// Lo que ve quien se postuló: nunca la nota interna del empleador.
const aEnviada = (f, base) => ({
    id: Number(f.id),
    estado: f.estado,
    mensaje: f.mensaje,
    creadoEn: f.creado_en,
    actualizadoEn: f.actualizado_en,
    cv: { nombre: f.cv_nombre, bytes: f.cv_bytes },
    anuncio: {
        id: Number(f.anuncio_id),
        titulo: f.anuncio_titulo,
        // Una vacante cubierta o pausada se sigue listando, pero se avisa.
        abierta: f.anuncio_estado === 'PUBLICADO' && !f.anuncio_cerrado,
    },
    empleador: {
        id: f.dueno_id,
        nombre: f.negocio_nombre || nombrePersona(f.dueno_nombres, f.dueno_apellidos),
        foto: urlPublica(base, f.negocio_logo),
    },
});

// ---------- Casos de uso ----------

const postular = async ({ anuncioId, usuarioId, tipoCuenta, archivo, datos, frontendUrl }) => {
    // Los negocios publican vacantes; postularse es cosa de personas.
    if (tipoCuenta !== 'PERSONA') throw error('Solo las cuentas personales pueden postularse a vacantes', 403);
    if (!/^\d+$/.test(String(anuncioId))) throw error('Anuncio no encontrado', 404);
    const anuncio = await anuncioModel.buscarPorId(anuncioId);
    if (!anuncio || anuncio.eliminado_en) throw error('Anuncio no encontrado', 404);
    if (anuncio.pilar !== 'empleo') throw error('Solo se puede postular a ofertas de empleo', 400);
    if (anuncio.autor_usuario_id === usuarioId) throw error('No puedes postularte a tu propia vacante', 400);
    if (anuncio.estado !== 'PUBLICADO' || anuncio.vendido) throw error('Esta vacante ya no recibe postulaciones', 409);

    const errores = {};
    if (!archivo) errores.cv = 'Adjunta tu hoja de vida en PDF';

    const mensaje = typeof datos.mensaje === 'string' ? datos.mensaje.trim() : '';
    if (mensaje.length > MENSAJE_MAX) errores.mensaje = `El mensaje no puede superar ${MENSAJE_MAX} caracteres`;

    const tel = normalizarTelefono(datos.telefono ?? null);
    if (!tel.ok) errores.telefono = 'El teléfono no es válido';

    if (Object.keys(errores).length > 0) throw errorValidacion(errores);

    if (await postulacionModel.deUsuarioEnAnuncio(anuncio.id, usuarioId)) {
        throw error('Ya te postulaste a esta vacante', 409);
    }

    // Se guarda primero el archivo y luego la fila; si la fila falla, se borra.
    const carpeta = path.join('cvs', String(new Date().getFullYear()));
    const cvKey = path.join(carpeta, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.pdf`);
    await fs.promises.mkdir(path.join(env.privadoDir, carpeta), { recursive: true });
    await fs.promises.writeFile(rutaCv(cvKey), archivo.buffer);

    let id;
    try {
        id = await postulacionModel.crear({
            anuncioId: anuncio.id,
            postulanteId: usuarioId,
            mensaje: mensaje || null,
            telefono: tel.valor,
            cvKey,
            cvNombre: nombreSeguro(archivo.originalname),
            cvBytes: archivo.size,
        });
    } catch (e) {
        fs.promises.unlink(rutaCv(cvKey)).catch(() => {});
        throw e;
    }
    if (!id) {
        // Dos envíos a la vez: ganó el otro.
        fs.promises.unlink(rutaCv(cvKey)).catch(() => {});
        throw error('Ya te postulaste a esta vacante', 409);
    }

    // El aviso por correo no debe tumbar la postulación si el SMTP falla.
    Promise.all([usuarioModel.buscarPorId(anuncio.autor_usuario_id), usuarioModel.buscarPorId(usuarioId)])
        .then(([dueno, postulante]) => {
            if (!dueno?.correo) return null;
            return emailService.enviarNuevaPostulacion(dueno.correo, {
                nombrePostulante: nombrePersona(postulante?.nombres, postulante?.apellidos) || 'Un candidato',
                tituloVacante: anuncio.titulo,
                enlace: `${frontendUrl}/postulaciones?anuncio=${anuncio.id}`,
            });
        })
        .catch((e) => console.error('[postulaciones] no se pudo avisar por correo:', e.message));

    return { id: Number(id), estado: 'NUEVA' };
};

const listarRecibidas = async ({ usuarioId, tipoCuenta, query, base }) => {
    exigirNegocio(tipoCuenta);
    const anuncioId = query.anuncio && /^\d+$/.test(query.anuncio) ? query.anuncio : null;
    const estado = query.estado || null;
    if (estado && !ESTADOS.includes(estado)) throw error("Parámetro 'estado' inválido", 400);
    const limite = entero(query.limite, 30, 1, 100);
    const offset = entero(query.offset, 0, 0, 100000);

    const [filas, resumen] = await Promise.all([
        postulacionModel.listarRecibidas({ duenoId: usuarioId, anuncioId, estado, limite: limite + 1, offset }),
        postulacionModel.resumenRecibidas(usuarioId),
    ]);
    const hayMas = filas.length > limite;
    return {
        items: filas.slice(0, limite).map((f) => aRecibida(f, base)),
        hayMas,
        resumen: {
            porEstado: Object.fromEntries(resumen.porEstado.map((r) => [r.estado, r.total])),
            vacantes: resumen.porVacante.map((v) => ({
                id: Number(v.id),
                titulo: v.titulo,
                abierta: v.estado === 'PUBLICADO' && !v.vendido,
                total: v.total,
                nuevas: v.nuevas,
            })),
        },
    };
};

// El módulo de vacantes: cada una con su anuncio, el embudo de candidatos por
// estado y las caras de los últimos que se postularon.
const listarVacantes = async ({ usuarioId, tipoCuenta, base }) => {
    exigirNegocio(tipoCuenta);
    const filas = await postulacionModel.listarVacantes(usuarioId);
    return {
        items: filas.map((f) => ({
            id: Number(f.id),
            slug: f.slug,
            titulo: f.titulo,
            estado: f.estado,
            vendido: f.vendido,
            vendidoEn: f.vendido_en,
            abierta: f.estado === 'PUBLICADO' && !f.vendido,
            precio: f.precio,
            moneda: f.moneda,
            ubicacion: f.canton_nombre,
            sector: f.sector,
            categoria: f.categoria_nombre,
            detalle: { jornada: f.jornada, modalidad: f.modalidad },
            portada: f.portada_key ? urlPublica(base, `/uploads/${f.portada_key}`) : null,
            vistas: f.vistas,
            publicadoEn: f.publicado_en,
            creadoEn: f.creado_en,
            postulaciones: { total: f.total, porEstado: f.por_estado },
            recientes: f.recientes.map((r) => ({
                nombre: nombrePersona(r.nombres, r.apellidos),
                foto: urlPublica(base, r.foto_perfil),
            })),
        })),
    };
};

const listarEnviadas = async ({ usuarioId, query, base }) => {
    const limite = entero(query.limite, 30, 1, 100);
    const offset = entero(query.offset, 0, 0, 100000);
    const filas = await postulacionModel.listarEnviadas({ postulanteId: usuarioId, limite: limite + 1, offset });
    return {
        items: filas.slice(0, limite).map((f) => aEnviada(f, base)),
        hayMas: filas.length > limite,
    };
};

// Solo el dueño de la vacante cambia el estado o la nota.
const actualizar = async ({ id, usuarioId, tipoCuenta, datos, base }) => {
    exigirNegocio(tipoCuenta);
    const fila = /^\d+$/.test(String(id)) ? await postulacionModel.buscarPorId(id) : null;
    if (!fila || fila.dueno_id !== usuarioId) throw error('Postulación no encontrada', 404);

    const cambios = {};
    if (datos.estado !== undefined) {
        if (!ESTADOS.includes(datos.estado) || datos.estado === 'NUEVA') throw error('Estado inválido', 400);
        cambios.estado = datos.estado;
    }
    if (datos.notaInterna !== undefined) {
        if (datos.notaInterna !== null && typeof datos.notaInterna !== 'string') throw error('Nota inválida', 400);
        const nota = (datos.notaInterna || '').trim();
        if (nota.length > NOTA_MAX) throw error(`La nota no puede superar ${NOTA_MAX} caracteres`, 400);
        cambios.notaInterna = nota || null;
    }
    if (Object.keys(cambios).length === 0) throw error('No se enviaron cambios', 400);

    await postulacionModel.actualizar(fila.id, cambios);
    return aRecibida(await postulacionModel.buscarPorId(fila.id), base);
};

// Quien se postuló puede retirarla; se borra también su CV.
const retirar = async ({ id, usuarioId }) => {
    const fila = /^\d+$/.test(String(id)) ? await postulacionModel.buscarPorId(id) : null;
    if (!fila || fila.postulante_id !== usuarioId) throw error('Postulación no encontrada', 404);
    await postulacionModel.eliminar(fila.id);
    fs.promises.unlink(rutaCv(fila.cv_key)).catch(() => {});
};

// El PDF: solo para el dueño de la vacante o quien se postuló.
const obtenerCv = async ({ id, usuarioId }) => {
    const fila = /^\d+$/.test(String(id)) ? await postulacionModel.buscarPorId(id) : null;
    const esDueno = fila && fila.dueno_id === usuarioId;
    const esPostulante = fila && fila.postulante_id === usuarioId;
    if (!fila || (!esDueno && !esPostulante)) throw error('Postulación no encontrada', 404);

    const ruta = rutaCv(fila.cv_key);
    try {
        await fs.promises.access(ruta);
    } catch {
        throw error('El archivo ya no está disponible', 410);
    }
    if (esDueno) postulacionModel.marcarVista(fila.id).catch(() => {});
    return { ruta, nombre: fila.cv_nombre };
};

// Para la ficha del anuncio (GET /api/anuncios/:id).
const infoParaAnuncio = async (fila, usuarioId) => {
    if (fila.pilar !== 'empleo' || !usuarioId) return {};
    if (fila.autor_usuario_id === usuarioId) {
        const { total, nuevas } = await postulacionModel.contarPorAnuncio(fila.id);
        return { postulaciones: { total, nuevas } };
    }
    const mia = await postulacionModel.deUsuarioEnAnuncio(fila.id, usuarioId);
    return { miPostulacion: mia ? { id: Number(mia.id), estado: mia.estado, creadoEn: mia.creado_en } : null };
};

module.exports = { postular, listarRecibidas, listarVacantes, listarEnviadas, actualizar, retirar, obtenerCv, infoParaAnuncio };
