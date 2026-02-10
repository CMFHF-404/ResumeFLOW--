/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string
    readonly VITE_LOGTO_ENDPOINT: string
    readonly VITE_LOGTO_APP_ID: string
    readonly VITE_LOGTO_REDIRECT_URI: string
    readonly VITE_LOGTO_RESOURCE: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

interface Window {
    umami?: {
        track: (eventName?: string, eventData?: Record<string, any>) => void
    }
}
