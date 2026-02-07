/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_API_BASE_URL: string
    readonly VITE_LOGTO_ENDPOINT: string
    readonly VITE_LOGTO_APP_ID: string
    readonly VITE_LOGTO_REDIRECT_URI: string
    readonly VITE_LOGTO_RESOURCE: string
    readonly VITE_PUBLIC_POSTHOG_ENABLED?: string
    readonly VITE_PUBLIC_POSTHOG_KEY?: string
    readonly VITE_PUBLIC_POSTHOG_HOST?: string
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}
