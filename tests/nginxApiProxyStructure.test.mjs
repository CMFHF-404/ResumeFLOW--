import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('production nginx mirrors the Vite API proxy without swallowing payment callbacks', () => {
  const nginx = read('nginx.conf');

  const callbackLocation = nginx.match(
    /location = \/api\/billing\/payments\/yifut\/notify\s*\{([\s\S]*?)\n\s*\}/,
  )?.[1];
  const apiLocation = nginx.match(/location \^~ \/api\/\s*\{([\s\S]*?)\n\s*\}/)?.[1];

  assert.ok(callbackLocation, 'expected an exact Yifut callback proxy');
  assert.ok(apiLocation, 'expected a production /api proxy');
  assert.match(
    callbackLocation,
    /proxy_pass http:\/\/\$\{BACKEND_UPSTREAM\}\/api\/billing\/payments\/yifut\/notify;/,
  );
  assert.doesNotMatch(callbackLocation, /proxy_pass[^;]*\?/);
  assert.match(callbackLocation, /proxy_buffering off;/);
  assert.match(callbackLocation, /proxy_request_buffering off;/);
  assert.match(apiLocation, /proxy_pass http:\/\/\$\{BACKEND_UPSTREAM\}\//);
  assert.doesNotMatch(apiLocation, /\brewrite\b/);
  assert.match(apiLocation, /proxy_buffering off;/);
  assert.match(apiLocation, /proxy_request_buffering off;/);
  assert.match(apiLocation, /proxy_read_timeout 310s;/);
  assert.match(
    nginx,
    /map \$http_x_forwarded_proto \$upstream_forwarded_proto \{\s*default \$scheme;\s*https https;\s*\}/,
  );
  assert.doesNotMatch(nginx, /proxy_set_header X-Forwarded-Proto \$http_x_forwarded_proto;/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto \$upstream_forwarded_proto;/);
  assert.match(nginx, /client_max_body_size 10m;/);
  assert.match(nginx, /location \/ \{\s*try_files \$uri \$uri\/ \/index\.html;/);
});

test('frontend image renders the nginx template with the private backend upstream', () => {
  const dockerfile = read('Dockerfile');

  assert.match(
    dockerfile,
    /ARG BACKEND_UPSTREAM=resumeflow-botism\.zeabur\.internal:8000/,
  );
  assert.match(dockerfile, /NGINX_ENVSUBST_FILTER=BACKEND_UPSTREAM/);
  assert.match(
    dockerfile,
    /COPY nginx\.conf \/etc\/nginx\/templates\/default\.conf\.template/,
  );
  assert.doesNotMatch(dockerfile, /COPY nginx\.conf \/etc\/nginx\/conf\.d\/default\.conf/);
});
