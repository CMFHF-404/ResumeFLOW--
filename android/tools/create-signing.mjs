import { mkdirSync, existsSync, writeFileSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backup = resolve(root, 'private/release-signing-backup');
const store = resolve(backup, 'resumeflow-release.p12');
const settings = resolve(root, 'signing.properties');
if (existsSync(backup) || existsSync(settings)) throw new Error('Signing already exists. Refusing to replace the application identity.');
if (!process.env.JAVA_HOME) throw new Error('Set JAVA_HOME to JDK 17 or 21 first.');
mkdirSync(backup, {recursive:true});
const password = randomBytes(32).toString('base64url');
const alias = 'resumeflow-release';
const result = spawnSync(resolve(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'keytool.exe' : 'keytool'), [
  '-genkeypair','-keystore',store,'-storetype','PKCS12','-alias',alias,
  '-keyalg','RSA','-keysize','4096','-validity','10000',
  '-dname','CN=ResumeFlow Android, OU=Mobile, O=ResumeFlow, C=CN',
  '-storepass:env','RF_KEY_PASSWORD','-keypass:env','RF_KEY_PASSWORD','-noprompt'
], {env:{...process.env,RF_KEY_PASSWORD:password}, encoding:'utf8'});
if (result.status !== 0) throw new Error(`Key generation failed (${result.status}); inspect the private folder before retrying.`);
writeFileSync(resolve(backup,'credentials.json'), JSON.stringify({storeFile:'resumeflow-release.p12',keyAlias:alias,storePassword:password,keyPassword:password}, null,2), {mode:0o600});
writeFileSync(settings, `storeFile=private/release-signing-backup/resumeflow-release.p12\nkeyAlias=${alias}\nstorePassword=${password}\nkeyPassword=${password}\n`, {mode:0o600});
writeFileSync(resolve(backup,'保管说明.txt'), '此文件夹是原子简历 cn.resumeflow.app 的长期发布签名备份。\n请保存到你控制的加密离线存储，并限制访问。不要随 APK 分发，不要提交 Git。\n后续更新必须使用同一包名、同一签名。丢失密钥将无法覆盖升级已安装应用。\ncredentials.json 包含密码；resumeflow-release.p12 为签名文件。\n在新机器将 storeFile 设置为此签名文件路径，并从 credentials.json 填写 android/signing.properties，其格式见 README。\n');
console.log('Created release identity and private backup. Passwords were not printed.');
