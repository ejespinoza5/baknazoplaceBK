const { MemoryStore } = require('express-rate-limit');
const redis = require('../config/redis');

// Dónde cuentan los límites de peticiones (express-rate-limit).
//
// Con Redis, el conteo es uno solo para todos los procesos de la API: si algún
// día corre en varios (PM2 en modo clúster, dos servidores), un atacante no
// multiplica su límite por el número de procesos. Si Redis no está o se cae,
// cada petición cuenta en la memoria del proceso: nunca se bloquea ni se tumba
// la API por culpa de Redis.

// Suma uno y, si la clave es nueva, le pone la ventana. Atómico en Redis.
const SUMAR = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { hits, ttl }`;

class AlmacenLimites {
    constructor(nombre) {
        this.prefijo = `${redis.PREFIJO}rl:${nombre}:`;
        this.memoria = new MemoryStore();
        // Las claves no viven solo en este proceso (con Redis se comparten).
        this.localKeys = false;
    }

    init(opciones) {
        this.windowMs = opciones.windowMs;
        this.memoria.init(opciones);
    }

    async increment(clave) {
        const c = redis.disponible();
        if (c) {
            try {
                const [hits, ttl] = await c.sendCommand(['EVAL', SUMAR, '1', this.prefijo + clave, String(this.windowMs)]);
                return { totalHits: Number(hits), resetTime: new Date(Date.now() + Number(ttl)) };
            } catch {
                /* se cuenta en memoria esta vez */
            }
        }
        return this.memoria.increment(clave);
    }

    async decrement(clave) {
        const c = redis.disponible();
        if (c) {
            try {
                await c.sendCommand(['DECR', this.prefijo + clave]);
                return;
            } catch {
                /* en memoria */
            }
        }
        await this.memoria.decrement(clave);
    }

    async resetKey(clave) {
        const c = redis.disponible();
        if (c) await c.sendCommand(['DEL', this.prefijo + clave]).catch(() => undefined);
        await this.memoria.resetKey(clave);
    }
}

module.exports = { AlmacenLimites };
