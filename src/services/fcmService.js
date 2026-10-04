const { JWT } = require('google-auth-library');
const env = require('../config/env');

// Envío de push con la API HTTP v1 de Firebase Cloud Messaging.
//
// Usa google-auth-library (ya instalada para el login con Google) para firmar
// con la cuenta de servicio y pedir el token OAuth; no hace falta firebase-admin.
// El cliente JWT guarda el token de acceso y lo renueva solo.

const ALCANCE = 'https://www.googleapis.com/auth/firebase.messaging';

// Errores de FCM que significan "este token ya no sirve": se borra.
const TOKEN_INVALIDO = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH', 'NOT_FOUND']);

let cliente = null;

const configurado = () => Boolean(env.firebase.projectId && env.firebase.clientEmail && env.firebase.privateKey);

const obtenerCliente = () => {
    if (!cliente) {
        cliente = new JWT({ email: env.firebase.clientEmail, key: env.firebase.privateKey, scopes: [ALCANCE] });
    }
    return cliente;
};

const codigoDeError = (e) => {
    const detalles = e?.response?.data?.error?.details || [];
    const fcm = detalles.find((d) => d.errorCode)?.errorCode;
    return fcm || e?.response?.data?.error?.status || null;
};

// El mensaje según quién lo recibe.
//
// - Navegador: solo datos. Su service worker lo convierte en notificación y
//   decide el sonido, la etiqueta que agrupa y a dónde lleva al pulsarla.
// - Android (la app): un mensaje solo de datos no se ve con la app cerrada,
//   así que va con la notificación armada. El canal decide si suena (la app
//   crea 'baknazo' y 'baknazo-silencio'), el tag agrupa como en la web y
//   `data.url` es la pantalla que abre la app al pulsarla.
//
// Todos los valores de `data` deben ser texto (lo exige FCM).
const mensajePara = ({ token, plataforma }, data) => {
    if (plataforma === 'android') {
        return {
            token,
            data,
            android: {
                priority: 'HIGH',
                ttl: '86400s',
                notification: {
                    title: data.titulo,
                    body: data.texto,
                    tag: data.etiqueta,
                    channel_id: data.silencio === '1' ? 'baknazo-silencio' : 'baknazo',
                    icon: 'ic_stat_baknazo',
                    color: '#ffb800',
                },
            },
        };
    }
    return { token, data, webpush: { headers: { Urgency: 'high', TTL: String(24 * 60 * 60) } } };
};

// Devuelve los tokens que FCM declaró inválidos, para borrarlos.
// `dispositivos` son filas { token, plataforma }; un texto suelto cuenta como navegador.
const enviar = async (dispositivos, data) => {
    if (!configurado() || dispositivos.length === 0) return { invalidos: [] };
    const url = `https://fcm.googleapis.com/v1/projects/${env.firebase.projectId}/messages:send`;
    const invalidos = [];

    await Promise.all(
        dispositivos.map(async (dispositivo) => {
            const destino = typeof dispositivo === 'string' ? { token: dispositivo, plataforma: 'web' } : dispositivo;
            const { token } = destino;
            try {
                await obtenerCliente().request({
                    url,
                    method: 'POST',
                    data: { message: mensajePara(destino, data) },
                });
            } catch (e) {
                const codigo = codigoDeError(e);
                if (TOKEN_INVALIDO.has(codigo) || e?.response?.status === 404) {
                    invalidos.push(token);
                } else {
                    // Cuota, red o credenciales: se registra y se sigue; el
                    // aviso dentro de la app ya quedó guardado.
                    console.error('[fcm] no se pudo enviar:', codigo || e.message);
                }
            }
        })
    );
    return { invalidos };
};

module.exports = { configurado, enviar };
