import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const importTypeScriptModule = async (path) => {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
};

test('payment checkout accepts only the configured build-time origin', async () => {
  const {
    assertPaymentCheckoutOrigin,
    PaymentCheckoutOriginMismatchError,
  } = await importTypeScriptModule('components/paymentCheckoutOrigin.ts');

  assert.doesNotThrow(() => assertPaymentCheckoutOrigin(
    'https://www.yifut.com/api/pay/submit',
    'https://www.yifut.com',
  ));

  for (const action of [
    'https://other.yifut.com/api/pay/submit',
    'http://www.yifut.com/api/pay/submit',
    'https://user@www.yifut.com/api/pay/submit',
    'not-a-url',
  ]) {
    assert.throws(
      () => assertPaymentCheckoutOrigin(action, 'https://www.yifut.com'),
      PaymentCheckoutOriginMismatchError,
    );
  }

  assert.throws(
    () => assertPaymentCheckoutOrigin(
      'https://www.yifut.com/api/pay/submit',
      'https://www.yifut.com/path',
    ),
    /已阻止跳转/,
  );
});
