import assert from 'node:assert';
import { test } from 'node:test';
import ts from 'typescript';
import { printer } from '../../../src/print';
import { SourcesMap, createMemoryProgram } from '../../../src/program';
import { createOverrideDefineTransformer } from '../../../src/transforms';

function transformReplacement(
  generated: string,
  replacement: string
): string {
  const sourcePath = '/source.ts';
  const sources = new SourcesMap();
  sources.set(sourcePath, generated);
  sources.set('/$virtual/overrides/Owner.ts', replacement);
  const program = createMemoryProgram(sources);
  const sourceFile = program.getSourceFile(sourcePath);
  assert(sourceFile !== undefined);
  const result = ts.transform(sourceFile, [
    createOverrideDefineTransformer(program, new Set(['Owner'])),
  ]);
  try {
    assert.strictEqual(result.transformed.length, 1);
    return printer.printFile(result.transformed[0]);
  } finally {
    result.dispose();
  }
}

test('generic generated owner to nongeneric replacement', () => {
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
  assert.doesNotMatch(output, /Owner<T>/);
});

test('generic generated owner to generic replacement', () => {
  const output = transformReplacement(
    `declare abstract class Owner<T> {
      method(this: __JSG_GENERATED_RECEIVER__<Owner>): void;
    }`,
    `interface Owner<U> {
      method(): void;
    }`
  );
  assert.match(output, /interface Owner<U>/);
  assert.match(
    output,
    /method\(this: __JSG_GENERATED_RECEIVER__<Owner<U>>\): void;/
  );
});

test('nongeneric generated owner to generic replacement', () => {
  const output = transformReplacement(
    `declare abstract class Owner {
      method(this: __JSG_GENERATED_RECEIVER__<Owner>): void;
    }`,
    `interface Owner<U> {
      method(): void;
    }`
  );
  assert.match(output, /interface Owner<U>/);
  assert.match(
    output,
    /method\(this: __JSG_GENERATED_RECEIVER__<Owner<U>>\): void;/
  );
});
