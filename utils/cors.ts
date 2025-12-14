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

    // In development, allow all origins if none specified
    if (process.env.NODE_ENV !== 'production' && allowed.length === 0) {
        return {
            origin: true,
            methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
            allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
            credentials: true,
            preflightContinue: false,
            optionsSuccessStatus: 204,
        }
    }

    return {
        origin(origin, callback) {
            try {
                // Allow requests without origin (e.g., Postman, curl)
                if (!origin) return callback(null, true)

                // Check if origin matches any allowed origin
                const ok = allowed.some((a) => {
                    if (typeof a === 'string') {
                        // Exact match or match without trailing slash
                        return a === origin || a === origin.replace(/\/$/, '')
                    }
                    return (a as RegExp).test(origin)
                })

                if (ok) {
                    console.log(`✅ CORS allowed: ${origin}`)
                    return callback(null, true)
                }

                console.warn(`❌ CORS blocked: ${origin} (allowed: ${JSON.stringify(allowed)})`)
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
