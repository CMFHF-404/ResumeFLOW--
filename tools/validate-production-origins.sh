#!/bin/sh
set -eu

fail_origin() {
    echo "Invalid $1: expected an exact HTTPS origin" >&2
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

validate_origin_value() {
    origin_name="$1"
    origin_value="$2"
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

manifest_path="${1:-/etc/resumeflow/built-origins.env}"
[ -r "$manifest_path" ] || fail_manifest

manifest_line_count="$(wc -l < "$manifest_path" | tr -d '[:space:]')"
[ "$manifest_line_count" = "3" ] || fail_manifest

for origin_name in VITE_API_BASE_URL VITE_LOGTO_ENDPOINT YIFUT_BASE_URL; do
    manifest_match_count="$(grep -c "^${origin_name}=" "$manifest_path" || true)"
    [ "$manifest_match_count" = "1" ] || fail_manifest

    built_origin="$(grep "^${origin_name}=" "$manifest_path" | cut -d= -f2-)"
    runtime_origin="$(printenv "$origin_name" || true)"
    validate_origin_value "$origin_name" "$built_origin"
    validate_origin_value "$origin_name" "$runtime_origin"
    [ "$runtime_origin" = "$built_origin" ] || fail_drift "$origin_name"
done
