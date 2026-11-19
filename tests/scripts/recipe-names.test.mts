// The member name of a native symbol (HYR-5 "Symbol"): the last name of the qualified name, for a PHP class member, a PHP
// namespace function such as the host function `Polyspec\Hyper\run` of HY-106.20, a Node or Python class member and a
// module function.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { symbolName } from '../../scripts/recipe/names.mts';

test('the name of a PHP namespace function is its name without the namespace (HYR-5, HY-106.20)', () => {
  assert.equal(symbolName('packages/php/src/Host/Run.php::Polyspec\\Hyper\\run'), 'run');
});

test('the name of a class member and of a module function is the member (HYR-5)', () => {
  assert.equal(symbolName('packages/php/src/Csrf/Csrf.php::Polyspec\\Hyper\\Csrf::raw'), 'raw');
  assert.equal(symbolName('packages/ts/src/csrf/csrf.ts::Csrf.raw'), 'raw');
  assert.equal(symbolName('packages/python/src/polyspec/hyper/host/wsgi.py::create_wsgi'), 'create_wsgi');
});

