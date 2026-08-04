// Copyright (c) 2022-2023 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from 'assert';
import { test } from 'node:test';
import path from 'path';
import ts from 'typescript';
import { printer } from '../../src/print';
import { createMemoryProgram } from '../../src/program';
import { createReceiverCleanupTransformer } from '../../src/receiver';
import { createGlobalScopeTransformer } from '../../src/transforms';

test('createGlobalScopeTransformer: extracts global scope', () => {
  const source = `type WorkerGlobalScopeEventMap = {
    fetch: Event;
    scheduled: Event;
};
declare class EventTarget<EventMap extends Record<string, Event> = Record<string, Event>> {
    constructor();
    addEventListener<Type extends keyof EventMap>(this: __JSG_GENERATED_RECEIVER__<EventTarget<EventMap>>, type: Type, handler: (event: EventMap[Type]) => void): void; // MethodDeclaration
    dispatchEvent(this: __JSG_GENERATED_RECEIVER__<EventTarget<EventMap>>, event: EventMap[keyof EventMap]): void; // MethodDeclaration
    explicitlyReceiverFree(this: void, value: string): string; // MethodDeclaration
    static detachable(value: string): string; // MethodDeclaration
}
declare class WorkerGlobalScope extends EventTarget<WorkerGlobalScopeEventMap> {
    thing: string; // PropertyDeclaration
    static readonly CONSTANT: 42; // PropertyDeclaration
    get property(): number; // GetAccessorDeclaration
    set property(value: number); // GetAccessorDeclaration
}
declare class DOMException {
}
declare abstract class Crypto {
}
declare abstract class Console {
}
interface ServiceWorkerGlobalScope extends WorkerGlobalScope {
    DOMException: typeof DOMException; // PropertySignature
    btoa(this: __JSG_GENERATED_RECEIVER__<ServiceWorkerGlobalScope>, value: string): string; // MethodSignature
    explicitVoid(this: void, value: string): string; // MethodSignature
    explicitCustom(this: ServiceWorkerGlobalScope | WorkerGlobalScope, value: string): string; // MethodSignature
    crypto: Crypto; // PropertySignature
    get console(): Console; // GetAccessorDeclaration
}
`;

  const sourcePath = path.resolve(__dirname, 'source.ts');
  const sources = new Map([[sourcePath, source]]);
  const program = createMemoryProgram(sources);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(sourcePath);
  assert(sourceFile !== undefined);

  const result = ts.transform(sourceFile, [
    createGlobalScopeTransformer(checker),
    createReceiverCleanupTransformer(),
  ]);
  assert.strictEqual(result.transformed.length, 1);

  const output = printer.printFile(result.transformed[0]);
  const cleanedSource = source
    .replaceAll(
      'this: __JSG_GENERATED_RECEIVER__<EventTarget<EventMap>>',
      'this: EventTarget<EventMap>'
    )
    .replace(
      'this: __JSG_GENERATED_RECEIVER__<ServiceWorkerGlobalScope>',
      'this: ServiceWorkerGlobalScope | typeof globalThis | null | void'
    );
  assert.strictEqual(
    output,
    // Extracted global nodes inserted after ServiceWorkerGlobalScope
    cleanedSource +
      `declare function addEventListener<Type extends keyof WorkerGlobalScopeEventMap>(this: EventTarget<WorkerGlobalScopeEventMap> | typeof globalThis | null | void, type: Type, handler: (event: WorkerGlobalScopeEventMap[Type]) => void): void;
declare function dispatchEvent(this: EventTarget<WorkerGlobalScopeEventMap> | typeof globalThis | null | void, event: WorkerGlobalScopeEventMap[keyof WorkerGlobalScopeEventMap]): void;
declare function explicitlyReceiverFree(this: void, value: string): string;
declare const thing: string;
declare const CONSTANT: 42;
declare const property: number;
declare function btoa(this: ServiceWorkerGlobalScope | typeof globalThis | null | void, value: string): string;
declare function explicitVoid(this: void, value: string): string;
declare function explicitCustom(this: ServiceWorkerGlobalScope | WorkerGlobalScope, value: string): string;
declare const crypto: Crypto;
declare const console: Console;
`
  );
});

test('createGlobalScopeTransformer: inlining type parameters in heritage', () => {
  const source = `declare class A<T> {
    thing: T;
}
declare class B<T> extends A<T> {
}
declare class ServiceWorkerGlobalScope extends B<string> {
}
`;

  const sourcePath = path.resolve(__dirname, 'source.ts');
  const sources = new Map([[sourcePath, source]]);
  const program = createMemoryProgram(sources);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(sourcePath);
  assert(sourceFile !== undefined);

  const result = ts.transform(sourceFile, [
    createGlobalScopeTransformer(checker),
  ]);
  assert.strictEqual(result.transformed.length, 1);

  const output = printer.printFile(result.transformed[0]);
  assert.strictEqual(
    output,
    source +
      `declare const thing: string;
`
  );
});

test('createGlobalScopeTransformer: resolves heritage in lexical scope', () => {
  const source = `declare class Base {
    topLevel(): string;
}
declare namespace Other {
    class Base {
        nestedOnly(): number;
    }
}
declare class ServiceWorkerGlobalScope extends Base {
}
`;

  const sourcePath = path.resolve(__dirname, 'source.ts');
  const sources = new Map([[sourcePath, source]]);
  const program = createMemoryProgram(sources);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(sourcePath);
  assert(sourceFile !== undefined);

  const result = ts.transform(sourceFile, [
    createGlobalScopeTransformer(checker),
  ]);
  assert.strictEqual(result.transformed.length, 1);

  const output = printer.printFile(result.transformed[0]);
  assert.strictEqual(
    output,
    source +
      `declare function topLevel(): string;
`
  );
});

test('createGlobalScopeTransformer: uses transformed top-level heritage declarations', () => {
  const source = `declare class Base {
    stale(): string;
}
declare class ServiceWorkerGlobalScope extends Base {
}
`;

  const sourcePath = path.resolve(__dirname, 'transformed-source.ts');
  const sources = new Map([[sourcePath, source]]);
  const program = createMemoryProgram(sources);
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(sourcePath);
  assert(sourceFile !== undefined);

  const replaceBase: ts.TransformerFactory<ts.SourceFile> = (ctx) => {
    const visitor: ts.Visitor = (node) => {
      if (ts.isClassDeclaration(node) && node.name?.text === 'Base') {
        const transformed = ctx.factory.createMethodDeclaration(
          /* modifiers */ undefined,
          /* asteriskToken */ undefined,
          'transformed',
          /* questionToken */ undefined,
          /* typeParameters */ undefined,
          [],
          ctx.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword),
          /* body */ undefined
        );
        return ctx.factory.updateClassDeclaration(
          node,
          node.modifiers,
          node.name,
          node.typeParameters,
          node.heritageClauses,
          ctx.factory.createNodeArray([transformed])
        );
      }
      return ts.visitEachChild(node, visitor, ctx);
    };
    return (node) => ts.visitEachChild(node, visitor, ctx);
  };

  const result = ts.transform(sourceFile, [
    replaceBase,
    createGlobalScopeTransformer(checker),
  ]);
  assert.strictEqual(result.transformed.length, 1);

  const output = printer.printFile(result.transformed[0]);
  assert.match(output, /declare function transformed\(\): number;/);
  assert.doesNotMatch(output, /declare function stale\(\): string;/);
});
