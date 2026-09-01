#!/bin/sh
set -eu

fail_origin() {
    if [ "$1" = "VITE_API_BASE_URL" ]; then
        echo "Invalid $1: expected exactly /api" >&2
    else
        echo "Invalid $1: expected an exact HTTPS origin" >&2
    fi
    exit 1
}

fail_manifest() {
    echo "Invalid built origin manifest" >&2
    exit 1
}

fail_drift() {
    echo "Invalid $1: runtime origin does not match built origin manifest" >&2
    exit 1
}

fail_app_id() {
    echo "Invalid VITE_LOGTO_APP_ID: expected a public Logto application ID" >&2
    exit 1
}

fail_redirect() {
    echo "Invalid VITE_LOGTO_REDIRECT_URI: expected VITE_FRONTEND_ORIGIN/callback" >&2
    exit 1
}

validate_origin_value() {
    origin_name="$1"
    origin_value="$2"
    if [ "$origin_name" = "VITE_API_BASE_URL" ] && [ "$origin_value" = "/api" ]; then
        return
    fi
    case "$origin_value" in
        https://*) ;;
        *) fail_origin "$origin_name" ;;
    esac

    authority="${origin_value#https://}"
    case "$authority" in
        ""|*[!A-Za-z0-9.:-]*|.*|*.|-*|*-|*..*|*.-*|*-.*)
            fail_origin "$origin_name"
            ;;
        *:*:*)
            fail_origin "$origin_name"
            ;;
    esac

    case "$authority" in
        *:*)
            host="${authority%:*}"
            port="${authority##*:}"
            case "$host" in
                ""|.*|*.|-*|*-|*..*|*.-*|*-.*) fail_origin "$origin_name" ;;
            esac
            case "$port" in
                ""|*[!0-9]*) fail_origin "$origin_name" ;;
            esac
            if [ "${#port}" -gt 5 ] || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
                fail_origin "$origin_name"
            fi
            ;;
    esac
}

validate_api_base_url() {
    [ "$1" = "/api" ] || fail_origin "VITE_API_BASE_URL"
}

validate_logto_app_id() {
    case "$1" in
        ""|*[!A-Za-z0-9_-]*) fail_app_id ;;
    esac
}

validate_logto_redirect_uri() {
    redirect_uri="$1"
    frontend_origin="$2"
    [ "$redirect_uri" = "${frontend_origin}/callback" ] || fail_redirect
}

manifest_path="${1:-/etc/resumeflow/built-origins.env}"
[ -r "$manifest_path" ] || fail_manifest

manifest_line_count="$(wc -l < "$manifest_path" | tr -d '[:space:]')"
[ "$manifest_line_count" = "7" ] || fail_manifest

for origin_name in VITE_API_BASE_URL VITE_FRONTEND_ORIGIN VITE_LOGTO_ENDPOINT VITE_LOGTO_APP_ID VITE_LOGTO_REDIRECT_URI VITE_LOGTO_ACCOUNT_CENTER_URL YIFUT_BASE_URL; do
    manifest_match_count="$(grep -c "^${origin_name}=" "$manifest_path" || true)"
    [ "$manifest_match_count" = "1" ] || fail_manifest
done

built_api_base_url="$(grep '^VITE_API_BASE_URL=' "$manifest_path" | cut -d= -f2-)"
runtime_api_base_url="$(printenv VITE_API_BASE_URL || true)"
validate_api_base_url "$built_api_base_url"
validate_api_base_url "$runtime_api_base_url"
[ "$runtime_api_base_url" = "$built_api_base_url" ] || fail_drift "VITE_API_BASE_URL"

for origin_name in VITE_FRONTEND_ORIGIN VITE_LOGTO_ENDPOINT YIFUT_BASE_URL; do
    built_origin="$(grep "^${origin_name}=" "$manifest_path" | cut -d= -f2-)"
    runtime_origin="$(printenv "$origin_name" || true)"
    validate_origin_value "$origin_name" "$built_origin"
    validate_origin_value "$origin_name" "$runtime_origin"
    [ "$runtime_origin" = "$built_origin" ] || fail_drift "$origin_name"
done

built_logto_app_id="$(grep '^VITE_LOGTO_APP_ID=' "$manifest_path" | cut -d= -f2-)"
runtime_logto_app_id="$(printenv VITE_LOGTO_APP_ID || true)"
validate_logto_app_id "$built_logto_app_id"
validate_logto_app_id "$runtime_logto_app_id"
[ "$runtime_logto_app_id" = "$built_logto_app_id" ] || fail_drift "VITE_LOGTO_APP_ID"

built_frontend_origin="$(grep '^VITE_FRONTEND_ORIGIN=' "$manifest_path" | cut -d= -f2-)"
runtime_frontend_origin="$(printenv VITE_FRONTEND_ORIGIN || true)"
built_logto_redirect_uri="$(grep '^VITE_LOGTO_REDIRECT_URI=' "$manifest_path" | cut -d= -f2-)"
runtime_logto_redirect_uri="$(printenv VITE_LOGTO_REDIRECT_URI || true)"
validate_logto_redirect_uri "$built_logto_redirect_uri" "$built_frontend_origin"
validate_logto_redirect_uri "$runtime_logto_redirect_uri" "$runtime_frontend_origin"
[ "$runtime_logto_redirect_uri" = "$built_logto_redirect_uri" ] || fail_drift "VITE_LOGTO_REDIRECT_URI"

built_logto_account_center_url="$(grep '^VITE_LOGTO_ACCOUNT_CENTER_URL=' "$manifest_path" | cut -d= -f2-)"
runtime_logto_account_center_url="$(printenv VITE_LOGTO_ACCOUNT_CENTER_URL || true)"
case "$built_logto_account_center_url" in
    https://*) ;;
    *) fail_manifest ;;
esac
case "$runtime_logto_account_center_url" in
    https://*) ;;
    *) fail_origin "VITE_LOGTO_ACCOUNT_CENTER_URL" ;;
esac
[ "$runtime_logto_account_center_url" = "$built_logto_account_center_url" ] || fail_drift "VITE_LOGTO_ACCOUNT_CENTER_URL"
