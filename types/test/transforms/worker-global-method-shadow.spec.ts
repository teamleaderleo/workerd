// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from 'node:assert';
import { test } from 'node:test';
import path from 'node:path';
import ts from 'typescript';
import { printer } from '../../src/print';
import { createMemoryProgram } from '../../src/program';
import { createReceiverCleanupTransformer } from '../../src/receiver';
import {
  createGlobalScopeTransformer,
  createWorkerGlobalMethodShadowTransformer,
} from '../../src/transforms';

type NamedDeclaration = ts.InterfaceDeclaration | ts.ClassDeclaration;
type MethodNode = ts.MethodSignature | ts.MethodDeclaration;

function findDeclaration(
  sourceFile: ts.SourceFile,
  name: string
): NamedDeclaration {
  const declaration = sourceFile.statements.find(
    (statement): statement is NamedDeclaration =>
      (ts.isInterfaceDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name?.text === name
  );
  assert(declaration !== undefined);
  return declaration;
}

function findMethods(
  declaration: NamedDeclaration,
  name: string
): MethodNode[] {
  return declaration.members.filter(
    (member): member is MethodNode =>
      (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) &&
      ts.isIdentifier(member.name) &&
      member.name.text === name
  );
}

function receiverType(sourceFile: ts.SourceFile, method: MethodNode): string {
  const receiver = method.parameters[0];
  assert(receiver !== undefined);
  assert(receiver.type !== undefined);
  return printer.printNode(ts.EmitHint.Unspecified, receiver.type, sourceFile);
}

function transform(source: string): ts.SourceFile {
  const sourcePath = path.resolve(__dirname, 'source.ts');
  const program = createMemoryProgram(new Map([[sourcePath, source]]));
  const checker = program.getTypeChecker();
  const sourceFile = program.getSourceFile(sourcePath);
  assert(sourceFile !== undefined);

  const result = ts.transform(sourceFile, [
    createGlobalScopeTransformer(checker),
    createWorkerGlobalMethodShadowTransformer(checker),
    createReceiverCleanupTransformer(),
  ]);
  assert.strictEqual(result.transformed.length, 1);
  return result.transformed[0];
}

test('shadows only inherited receiver-marked Worker-global methods', () => {
  const sourceFile = transform(`type WorkerGlobalScopeEventMap = {
    fetch: Event;
    scheduled: Event;
};
declare class EventTarget<EventMap extends Record<string, Event> = Record<string, Event>> {
    addEventListener<Type extends keyof EventMap>(this: __JSG_GENERATED_RECEIVER__<EventTarget<EventMap>>, type: Type, handler: (event: EventMap[Type]) => void): void;
    dispatchEvent(this: __JSG_GENERATED_RECEIVER__<EventTarget<EventMap>>, event: EventMap[keyof EventMap]): void;
    explicitlyReceiverFree(this: void, value: string): string;
    static detachable(value: string): string;
}
declare class WorkerGlobalScope extends EventTarget<WorkerGlobalScopeEventMap> {
}
interface ServiceWorkerGlobalScope extends WorkerGlobalScope {
    btoa(this: __JSG_GENERATED_RECEIVER__<ServiceWorkerGlobalScope>, value: string): string;
}
`);

  const eventTarget = findDeclaration(sourceFile, 'EventTarget');
  const eventTargetAdd = findMethods(eventTarget, 'addEventListener');
  assert.strictEqual(eventTargetAdd.length, 1);
  assert.strictEqual(receiverType(sourceFile, eventTargetAdd[0]), 'EventTarget<EventMap>');

  const globalScope = findDeclaration(sourceFile, 'ServiceWorkerGlobalScope');
  const inheritedAdd = findMethods(globalScope, 'addEventListener');
  const inheritedDispatch = findMethods(globalScope, 'dispatchEvent');
  assert.strictEqual(inheritedAdd.length, 1);
  assert.strictEqual(inheritedDispatch.length, 1);
  assert.strictEqual(
    receiverType(sourceFile, inheritedAdd[0]),
    'EventTarget<WorkerGlobalScopeEventMap> | typeof globalThis | null | void'
  );
  assert.strictEqual(
    receiverType(sourceFile, inheritedDispatch[0]),
    'EventTarget<WorkerGlobalScopeEventMap> | typeof globalThis | null | void'
  );
  assert.strictEqual(findMethods(globalScope, 'explicitlyReceiverFree').length, 0);
  assert.strictEqual(findMethods(globalScope, 'detachable').length, 0);
  assert.strictEqual(findMethods(globalScope, 'btoa').length, 1);

  const globalAdd = sourceFile.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === 'addEventListener'
  );
  assert(globalAdd !== undefined);
  assert.strictEqual(
    receiverType(sourceFile, globalAdd as unknown as MethodNode),
    'EventTarget<WorkerGlobalScopeEventMap> | typeof globalThis | null | void'
  );
});

test('uses the nearest inherited method group and preserves overloads', () => {
  const sourceFile = transform(`declare class Base {
    listen(this: __JSG_GENERATED_RECEIVER__<Base>, value: string): void;
}
declare class Middle extends Base {
    listen(this: __JSG_GENERATED_RECEIVER__<Middle>, value: string): void;
    listen(this: __JSG_GENERATED_RECEIVER__<Middle>, value: number): void;
}
interface ServiceWorkerGlobalScope extends Middle {
}
`);

  const globalScope = findDeclaration(sourceFile, 'ServiceWorkerGlobalScope');
  const methods = findMethods(globalScope, 'listen');
  assert.strictEqual(methods.length, 2);
  for (const method of methods) {
    assert.strictEqual(
      receiverType(sourceFile, method),
      'Middle | typeof globalThis | null | void'
    );
  }
});
