// Registro de los sockets abiertos y autenticados, por usuario.
//
// Vive aparte del servidor WebSocket para que los servicios (y las rutas REST,
// como "marcar leído") puedan avisar en vivo sin depender de cómo se aceptan
// las conexiones. Es memoria de un solo proceso: si algún día la API corre en
// varias instancias, esto pasa a un pub/sub (p. ej. LISTEN/NOTIFY de Postgres).

const OPEN = 1; // WebSocket.OPEN, sin importar 'ws' aquí.

const porUsuario = new Map(); // usuarioId → Set<socket>

const registrar = (usuarioId, socket) => {
    let sockets = porUsuario.get(usuarioId);
    if (!sockets) {
        sockets = new Set();
        porUsuario.set(usuarioId, sockets);
    }
    sockets.add(socket);
};

const quitar = (usuarioId, socket) => {
    const sockets = porUsuario.get(usuarioId);
    if (!sockets) return;
    sockets.delete(socket);
    if (sockets.size === 0) porUsuario.delete(usuarioId);
};

const conexiones = (usuarioId) => porUsuario.get(usuarioId)?.size ?? 0;

const estaConectado = (usuarioId) => conexiones(usuarioId) > 0;

// Manda el evento a todos los dispositivos del usuario, salvo `excepto`.
const emitir = (usuarioId, evento, excepto = null) => {
    const sockets = porUsuario.get(usuarioId);
    if (!sockets) return;
    const datos = JSON.stringify(evento);
    for (const socket of sockets) {
        if (socket !== excepto && socket.readyState === OPEN) socket.send(datos);
    }
};

module.exports = { registrar, quitar, conexiones, estaConectado, emitir };
