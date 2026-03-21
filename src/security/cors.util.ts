const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:4173',
  'http://localhost:5173',
];

function normalizeOrigins(value: string | undefined) {
  const origins = value
    ?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins?.length ? origins : DEFAULT_ALLOWED_ORIGINS;
}

const allowedOrigins = new Set(normalizeOrigins(process.env.CORS_ORIGIN));

function allowOrigin(origin?: string | null) {
  if (!origin) {
    return true;
  }

  return allowedOrigins.has(origin);
}

function createOriginCallback() {
  return (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (allowOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin is not allowed by CORS'));
  };
}

export function buildCorsOptions() {
  return {
    origin: createOriginCallback(),
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  };
}

export function buildWebsocketCorsOptions() {
  return {
    origin: createOriginCallback(),
    methods: ['GET', 'POST'],
  };
}
