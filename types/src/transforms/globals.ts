// Copyright (c) 2022-2023 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from "node:assert";
import ts from "typescript";
import { getGeneratedReceiverOwner } from "../receiver";

// Copies all properties of `ServiceWorkerGlobalScope` and its superclasses into
// the global scope:
//
// ```ts
// export declare class EventTarget {
//   constructor();
//   addEventListener(...): ...;
// }
// export declare abstract WorkerGlobalScope extends EventTarget {
//   ...
// }
// export interface ServiceWorkerGlobalScope extends WorkerGlobalScope {
//   DOMException: typeof DOMException;
//   btoa(value: string): string;
//   crypto: Crypto;
//   ...
// }
// ```
//
// --- transforms to --->
//
// ```ts
// export declare class EventTarget { ... }
// export declare abstract WorkerGlobalScope extends EventTarget { ... }
// export interface ServiceWorkerGlobalScope extends WorkerGlobalScope { ... }
//
// export declare function addEventListener(...): ...;
// export declare function btoa(value: string): string;
// export declare const crypto: Crypto;
// ```
export function createGlobalScopeTransformer(
  checker: ts.TypeChecker
): ts.TransformerFactory<ts.SourceFile> {
  return (ctx) => {
    return (node) => {
      const declarations = collectNamedDeclarations(node);
      const visitor = createGlobalScopeVisitor(ctx, checker, declarations);
      return ts.visitEachChild(node, visitor, ctx);
    };
  };
}

function collectNamedDeclarations(
  sourceFile: ts.SourceFile
): Map<string, ts.InterfaceDeclaration | ts.ClassDeclaration> {
  const declarations = new Map<
    string,
    ts.InterfaceDeclaration | ts.ClassDeclaration
  >();
  const visitor = (node: ts.Node): void => {
    if (
      (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined
    ) {
      declarations.set(node.name.text, node);
    }
    ts.forEachChild(node, visitor);
  };
  visitor(sourceFile);
  return declarations;
}

// Copy type nodes everywhere they are referenced
function createInlineVisitor(
  ctx: ts.TransformationContext,
  inlines: Map<string, ts.TypeNode>
): ts.Visitor<ts.Node, ts.Node> {
  // If there's nothing to inline, just return identity visitor
  if (inlines.size === 0) return (node) => node;

  const visitor: ts.Visitor<ts.Node, ts.Node> = (node) => {
    // Recursively visit all nodes
    node = ts.visitEachChild(node, visitor, ctx);

    // Inline all matching type references
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      const inline = inlines.get(node.typeName.text);
      if (inline !== undefined) return inline;
    }

    return node;
  };
  return visitor;
}

function createContextGlobalParameters(
  ctx: ts.TransformationContext,
  parameters: readonly ts.ParameterDeclaration[]
): readonly ts.ParameterDeclaration[] {
  const receiver = parameters[0];
  const ownerType = getGeneratedReceiverOwner(receiver);
  if (receiver === undefined || ownerType === undefined) return parameters;

  const receiverType = ctx.factory.createUnionTypeNode([
    ownerType,
    ctx.factory.createTypeQueryNode(
      ctx.factory.createIdentifier("globalThis")
    ),
    ctx.factory.createLiteralTypeNode(ctx.factory.createNull()),
    ctx.factory.createKeywordTypeNode(ts.SyntaxKind.VoidKeyword),
  ]);
  const globalReceiver = ctx.factory.updateParameterDeclaration(
    receiver,
    receiver.modifiers,
    receiver.dotDotDotToken,
    receiver.name,
    receiver.questionToken,
    receiverType,
    receiver.initializer
  );
  return ctx.factory.createNodeArray([
    globalReceiver,
    ...parameters.slice(1),
  ]);
}

function updateMethodParameters(
  ctx: ts.TransformationContext,
  node: ts.MethodSignature,
  parameters: readonly ts.ParameterDeclaration[]
): ts.MethodSignature;
function updateMethodParameters(
  ctx: ts.TransformationContext,
  node: ts.MethodDeclaration,
  parameters: readonly ts.ParameterDeclaration[]
): ts.MethodDeclaration;
function updateMethodParameters(
  ctx: ts.TransformationContext,
  node: ts.MethodSignature | ts.MethodDeclaration,
  parameters: readonly ts.ParameterDeclaration[]
): ts.MethodSignature | ts.MethodDeclaration {
  if (parameters === node.parameters) return node;
  if (ts.isMethodSignature(node)) {
    return ctx.factory.updateMethodSignature(
      node,
      node.modifiers,
      node.name,
      node.questionToken,
      node.typeParameters,
      ctx.factory.createNodeArray(parameters),
      node.type
    );
  }
  return ctx.factory.updateMethodDeclaration(
    node,
    node.modifiers,
    node.asteriskToken,
    node.name,
    node.questionToken,
    node.typeParameters,
    ctx.factory.createNodeArray(parameters),
    node.type,
    node.body
  );
}

function withContextGlobalReceiver(
  ctx: ts.TransformationContext,
  member: ts.ClassElement | ts.TypeElement
): ts.ClassElement | ts.TypeElement {
  if (ts.isMethodSignature(member)) {
    return updateMethodParameters(
      ctx,
      member,
      createContextGlobalParameters(ctx, member.parameters)
    );
  }
  if (ts.isMethodDeclaration(member)) {
    return updateMethodParameters(
      ctx,
      member,
      createContextGlobalParameters(ctx, member.parameters)
    );
  }
  return member;
}

function widenContextGlobalScopeDeclaration(
  ctx: ts.TransformationContext,
  node: ts.InterfaceDeclaration | ts.ClassDeclaration
): ts.InterfaceDeclaration | ts.ClassDeclaration {
  if (ts.isInterfaceDeclaration(node)) {
    const members = node.members.map((member) =>
      withContextGlobalReceiver(ctx, member) as ts.TypeElement
    );
    return ctx.factory.updateInterfaceDeclaration(
      node,
      node.modifiers,
      node.name,
      node.typeParameters,
      node.heritageClauses,
      ctx.factory.createNodeArray(members)
    );
  }
  const members = node.members.map((member) =>
    withContextGlobalReceiver(ctx, member) as ts.ClassElement
  );
  return ctx.factory.updateClassDeclaration(
    node,
    node.modifiers,
    node.name,
    node.typeParameters,
    node.heritageClauses,
    ctx.factory.createNodeArray(members)
  );
}

// Call with each potential method/property that could be extracted into a
// global function/const.
export function maybeExtractGlobalNode(
  ctx: ts.TransformationContext,
  node: ts.Node,
  modifiers?: readonly ts.ModifierLike[]
): ts.Statement | undefined {
  if (
    (ts.isMethodSignature(node) || ts.isMethodDeclaration(node)) &&
    ts.isIdentifier(node.name)
  ) {
    return ctx.factory.createFunctionDeclaration(
      modifiers,
      /* asteriskToken */ undefined,
      node.name,
      node.typeParameters,
      node.parameters,
      node.type,
      /* body */ undefined
    );
  }
  if (
    (ts.isPropertySignature(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isGetAccessorDeclaration(node)) &&
    ts.isIdentifier(node.name)
  ) {
    assert(node.type !== undefined);
    // Don't create global nodes for nested types, they'll already be there
    if (!ts.isTypeQueryNode(node.type)) {
      const varDeclaration = ctx.factory.createVariableDeclaration(
        node.name,
        /* exclamationToken */ undefined,
        node.type
      );
      const varDeclarationList = ctx.factory.createVariableDeclarationList(
        [varDeclaration],
        ts.NodeFlags.Const // Use `const` instead of `var`
      );
      return ctx.factory.createVariableStatement(modifiers, varDeclarationList);
    }
  }
}

function createGlobalScopeVisitor(
  ctx: ts.TransformationContext,
  checker: ts.TypeChecker,
  declarations: Map<string, ts.InterfaceDeclaration | ts.ClassDeclaration>
): ts.Visitor {
  // Called with each class/interface that should have its methods/properties
  // extracted into global functions/consts. Recursively visits superclasses.
  function extractGlobalNodes(
    node: ts.InterfaceDeclaration | ts.ClassDeclaration,
    typeArgs?: ts.NodeArray<ts.TypeNode>
  ): ts.Node[] {
    const nodes: ts.Node[] = [];

    // If this declaration has type parameters, we'll need to inline them when
    // extracting members.
    const typeArgInlines = new Map<string, ts.TypeNode>();
    if (node.typeParameters) {
      assert(
        node.typeParameters.length === typeArgs?.length,
        `Expected ${node.typeParameters.length} type argument(s), got ${typeArgs?.length}`
      );
      node.typeParameters.forEach((typeParam, index) => {
        typeArgInlines.set(typeParam.name.text, typeArgs[index]);
      });
    }
    const inlineVisitor = createInlineVisitor(ctx, typeArgInlines);

    // Recursively extract from all superclasses
    if (node.heritageClauses !== undefined) {
      for (let clause of node.heritageClauses) {
        // Handle case where type param appears in heritage clause:
        // ```ts
        // class A<T> {}     // ↓
        // class B<T> extends A<T> {}
        // class C extends B<string> {}
        // ```
        clause = ts.visitNode(clause, inlineVisitor, ts.isHeritageClause);

        for (const superType of clause.types) {
          let superTypeDeclaration:
            | ts.InterfaceDeclaration
            | ts.ClassDeclaration
            | undefined;
          if (ts.isIdentifier(superType.expression)) {
            superTypeDeclaration = declarations.get(superType.expression.text);
          }
          if (superTypeDeclaration === undefined) {
            const superTypeSymbol = checker.getSymbolAtLocation(
              superType.expression
            );
            assert(superTypeSymbol !== undefined);
            const superTypeDeclarations = superTypeSymbol.getDeclarations();
            assert.strictEqual(superTypeDeclarations?.length, 1);
            const declaration = superTypeDeclarations[0];
            assert(
              ts.isInterfaceDeclaration(declaration) ||
                ts.isClassDeclaration(declaration)
            );
            superTypeDeclaration = declaration;
          }
          nodes.push(
            // Pass any defined type arguments for inlining in extracted nodes
            // (e.g. `...extends EventTarget<WorkerGlobalScopeEventMap>`).
            ...extractGlobalNodes(superTypeDeclaration, superType.typeArguments)
          );
        }
      }
    }

    // Extract methods/properties
    const modifiers: ts.Modifier[] = [
      ctx.factory.createToken(ts.SyntaxKind.DeclareKeyword),
    ];
    for (const member of node.members) {
      const globalMember = withContextGlobalReceiver(ctx, member);
      const maybeNode = maybeExtractGlobalNode(ctx, globalMember, modifiers);
      if (maybeNode !== undefined) {
        nodes.push(ts.visitNode(maybeNode, inlineVisitor));
      }
    }

    return nodes;
  }

  // Finds the `ServiceWorkerGlobalScope` declaration, calls
  // `extractGlobalNodes` with it, and inserts all extracted nodes.
  const serviceWorkerGlobalScopeVisitor: ts.Visitor = (node) => {
    if (
      (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) &&
      node.name !== undefined &&
      node.name.text === "ServiceWorkerGlobalScope"
    ) {
      const globalScope = widenContextGlobalScopeDeclaration(ctx, node);
      return [globalScope, ...extractGlobalNodes(globalScope)];
    }
    return node;
  };
  return serviceWorkerGlobalScopeVisitor;
}
