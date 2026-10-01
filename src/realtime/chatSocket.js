const { WebSocketServer } = require('ws');
const env = require('../config/env');
const { verificarAccessToken } = require('../services/tokenService');
const chatModel = require('../models/chatModel');
const chatService = require('../services/chatService');
const hub = require('./hub');

// Protocolo (JSON, un objeto por mensaje, el tipo en `t`):
//   cliente → servidor: auth {token} · enviar {conversacionId, contenido, clienteId} · ping
//   servidor → cliente: listo {usuarioId, noLeidos} · ack {clienteId, mensaje} ·
//     error {clienteId?, codigo, mensaje} · mensaje {mensaje, remitente?, noLeidos?} ·
//     entregado / leido {conversacionId, hastaId, fecha} · conversacion_leida ·
//     bloqueo {conversacionId, usuarioId, yoBloquee, meBloquearon} · pong
//
// El token NO va en la URL (quedaría en los logs del proxy): se manda en el
// primer mensaje. Hasta entonces el socket no puede hacer nada más.

const RUTA = '/ws/chat';
const TIEMPO_PARA_AUTENTICAR = 10_000;
const LATIDO = 30_000;
const MAX_SOCKETS_POR_USUARIO = 10;
// Ráfaga de envíos por socket: de sobra para escribir, corta un script.
const VENTANA_ENVIOS = 10_000;
const MAX_ENVIOS = 20;

// Códigos de cierre propios (4000–4999). El cliente decide con ellos si
// reconecta: 4401/4001 renuevan el token y vuelven; 4403 no.
const CIERRE = {
    SIN_AUTENTICAR: 4401,
    TOKEN_CADUCADO: 4001,
    PROHIBIDO: 4403,
    DEMASIADAS: 4429,
    FORMATO: 4400,
};

const enviarA = (ws, evento) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(evento));
};

const rechazarUpgrade = (socket, estado, texto) => {
    socket.write(`HTTP/1.1 ${estado} ${texto}\r\nConnection: close\r\n\r\n`);
    socket.destroy();
};

const autenticar = async (ws, token) => {
    let payload;
    try {
        payload = verificarAccessToken(String(token || ''));
    } catch {
        ws.close(CIERRE.TOKEN_CADUCADO, 'Token inválido o caducado');
        return;
    }

    // Reautenticación con un token renovado: solo alarga la sesión del socket,
    // y nunca puede cambiar de usuario.
    if (ws.usuarioId) {
        if (payload.sub !== ws.usuarioId) {
            ws.close(CIERRE.PROHIBIDO, 'Usuario distinto');
            return;
        }
    } else {
        // El token puede ser válido para una cuenta suspendida después de emitirlo.
        if (!(await chatModel.buscarUsuarioActivo(payload.sub))) {
            ws.close(CIERRE.PROHIBIDO, 'Cuenta no disponible');
            return;
        }
        if (hub.conexiones(payload.sub) >= MAX_SOCKETS_POR_USUARIO) {
            ws.close(CIERRE.DEMASIADAS, 'Demasiadas conexiones abiertas');
            return;
        }
        if (ws.readyState !== ws.OPEN) return; // se cerró mientras se consultaba
        clearTimeout(ws.temporizadorAuth);
        ws.usuarioId = payload.sub;
        hub.registrar(ws.usuarioId, ws);
    }

    // El socket vale lo mismo que el token: al caducar se cierra, salvo que el
    // cliente mande antes uno nuevo.
    clearTimeout(ws.temporizadorCaducidad);
    const restante = payload.exp * 1000 - Date.now();
    ws.temporizadorCaducidad = setTimeout(
        () => ws.close(CIERRE.TOKEN_CADUCADO, 'Token caducado'),
        Math.max(restante, 0)
    );

    if (!ws.listo) {
        ws.listo = true;
        const { total } = await chatService.contarNoLeidos({ usuarioId: ws.usuarioId });
        enviarA(ws, { t: 'listo', usuarioId: ws.usuarioId, noLeidos: total });
        chatService.alConectar(ws.usuarioId).catch((e) => console.error('[chat] acuses al conectar:', e.message));
    }
};

const enviarMensaje = async (ws, datos) => {
    const clienteId = typeof datos.clienteId === 'string' ? datos.clienteId.slice(0, 64) : null;

    const ahora = Date.now();
    ws.envios = ws.envios.filter((t) => ahora - t < VENTANA_ENVIOS);
    if (ws.envios.length >= MAX_ENVIOS) {
        enviarA(ws, { t: 'error', clienteId, codigo: 429, mensaje: 'Vas muy rápido. Espera un momento.' });
        return;
    }
    ws.envios.push(ahora);

    try {
        const mensaje = await chatService.enviar({
            usuarioId: ws.usuarioId,
            conversacionId: datos.conversacionId,
            contenido: datos.contenido,
            clienteId,
            base: ws.base,
            socketOrigen: ws,
        });
        enviarA(ws, { t: 'ack', clienteId, mensaje });
    } catch (e) {
        if (!e.status) console.error('[chat] enviar:', e.stack || e.message);
        enviarA(ws, {
            t: 'error',
            clienteId,
            codigo: e.status || 500,
            mensaje: e.status ? e.message : 'No se pudo enviar el mensaje',
        });
    }
};

const alRecibir = async (ws, crudo, esBinario) => {
    if (esBinario) {
        ws.close(CIERRE.FORMATO, 'Solo texto');
        return;
    }
    let datos;
    try {
        datos = JSON.parse(crudo.toString());
    } catch {
        ws.close(CIERRE.FORMATO, 'JSON inválido');
        return;
    }
    if (!datos || typeof datos !== 'object') return;

    if (datos.t === 'auth') return autenticar(ws, datos.token);
    if (!ws.usuarioId) {
        ws.close(CIERRE.SIN_AUTENTICAR, 'Autenticación requerida');
        return;
    }
    if (datos.t === 'ping') return enviarA(ws, { t: 'pong' });
    if (datos.t === 'enviar') return enviarMensaje(ws, datos);
    enviarA(ws, { t: 'error', codigo: 400, mensaje: 'Evento desconocido' });
};

const adjuntarChat = (servidor) => {
    // 16 KB por mensaje: un texto de 2000 caracteres con emojis cabe de sobra.
    const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

    servidor.on('upgrade', (req, socket, head) => {
        const { pathname } = new URL(req.url, 'http://localhost');
        if (pathname !== RUTA) return rechazarUpgrade(socket, 404, 'Not Found');
        // Mismo criterio que la protección CSRF de las cookies: un navegador
        // siempre manda Origin, y solo se aceptan los del frontend.
        const origen = req.headers.origin;
        if (origen && !env.corsOrigin.includes(origen)) return rechazarUpgrade(socket, 403, 'Forbidden');
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });

    wss.on('connection', (ws, req) => {
        // La URL pública de la API, para las fotos de los anuncios. Detrás de
        // Nginx el protocolo real llega en X-Forwarded-Proto (como req.protocol
        // en Express con 'trust proxy').
        const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || (req.socket.encrypted ? 'https' : 'http');
        ws.base = `${proto}://${req.headers.host}`;
        ws.usuarioId = null;
        ws.vivo = true;
        ws.envios = [];
        ws.temporizadorAuth = setTimeout(
            () => ws.close(CIERRE.SIN_AUTENTICAR, 'Autenticación requerida'),
            TIEMPO_PARA_AUTENTICAR
        );

        ws.on('pong', () => {
            ws.vivo = true;
        });
        ws.on('message', (crudo, esBinario) => {
            alRecibir(ws, crudo, esBinario).catch((e) => {
                console.error('[chat]', e.stack || e.message);
                enviarA(ws, { t: 'error', codigo: 500, mensaje: 'Error interno' });
            });
        });
        ws.on('close', () => {
            clearTimeout(ws.temporizadorAuth);
            clearTimeout(ws.temporizadorCaducidad);
            if (ws.usuarioId) hub.quitar(ws.usuarioId, ws);
        });
        ws.on('error', () => {}); // el 'close' que sigue limpia
    });

    // Los móviles dejan sockets medio muertos al cambiar de red: sin latido se
    // quedarían en el registro y el otro vería "entregado" sin que llegue.
    const latido = setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.vivo) {
                ws.terminate();
                continue;
            }
            ws.vivo = false;
            ws.ping();
        }
    }, LATIDO);
    wss.on('close', () => clearInterval(latido));

    return wss;
};

module.exports = { adjuntarChat, RUTA };
