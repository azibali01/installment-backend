import { CorsOptions } from 'cors'

export function parseAllowedOrigins(env?: string): Array<string | RegExp> {
    if (!env) return []
    return env
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
            if (s.startsWith('/') && s.endsWith('/')) {
                try {
                    const body = s.slice(1, -1)
                    return new RegExp(body)
                } catch (err) {
                    console.warn('Invalid origin regex in FRONTEND_URLS:', s)
                    return s
                }
            }

            return s
        })
}

export function createCorsOptions(frontendEnv?: string): CorsOptions {
    const allowed = parseAllowedOrigins(frontendEnv)

    return {
        origin(origin, callback) {
            try {

                if (!origin) return callback(null, true)

                const ok = allowed.some((a) => {
                    if (typeof a === 'string') return a === origin
                    return (a as RegExp).test(origin)
                })

                if (ok) return callback(null, true)

                console.warn('Blocked CORS origin:', origin)
                return callback(null, false)
            } catch (err) {
                console.error('CORS origin check error:', err)
                return callback(null, false)
            }
        },
        methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        credentials: true,
        preflightContinue: false,
        optionsSuccessStatus: 204,
    }
}
