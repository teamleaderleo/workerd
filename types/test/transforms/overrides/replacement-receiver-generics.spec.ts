// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from 'node:assert';
import { test } from 'node:test';
import ts from 'typescript';
import { printer } from '../../../src/print';
import { createMemoryProgram } from '../../../src/program';
import { createOverrideDefineTransformer } from '../../../src/transforms';

const sourcePath = '/source.ts';
const overridePath = '/$virtual/overrides/Owner.ts';

function transformReplacement(generated: string, override: string): string {
  const sources = new Map<string, string>([
    [sourcePath, generated],
    [overridePath, override],
  ]);
  const program = createMemoryProgram(sources);
  const source = program.getSourceFile(sourcePath);
  assert(source !== undefined);

  const result = ts.transform(source, [
    createOverrideDefineTransformer(program, new Set(['Owner'])),
  ]);
  assert.strictEqual(result.transformed.length, 1);
  return printer.printFile(result.transformed[0]);
}

test('generic generated owner to nongeneric replacement keeps a bound receiver', () => {
  const output = transformReplacement(
    `declare abstract class Owner<T> {
      method(this: __JSG_GENERATED_RECEIVER__<Owner>): void;
    }`,
    `interface Owner {
      method(): void;
    }`
  );

  assert.match(
    output,
    /method\(this: __JSG_GENERATED_RECEIVER__<Owner>\): void;/
  );
  assert.doesNotMatch(output, /__JSG_GENERATED_RECEIVER__<Owner<T>>/);
});

test('generic generated owner to generic replacement uses replacement parameters', () => {
  const output = transformReplacement(
    `declare abstract class Owner<T> {
      method(this: __JSG_GENERATED_RECEIVER__<Owner>): void;
    }`,
    `interface Owner<U> {
      method(): void;
    }`
  );

  assert.match(
    output,
    /method\(this: __JSG_GENERATED_RECEIVER__<Owner<U>>\): void;/
  );
  assert.doesNotMatch(output, /__JSG_GENERATED_RECEIVER__<Owner<T>>/);
});

test('nongeneric generated owner to generic replacement uses replacement parameters', () => {
  const output = transformReplacement(
    `declare abstract class Owner {
      method(this: __JSG_GENERATED_RECEIVER__<Owner>): void;
    }`,
    `interface Owner<U> {
      method(): void;
    }`
  );

  assert.match(
    output,
    /method\(this: __JSG_GENERATED_RECEIVER__<Owner<U>>\): void;/
  );
});
