// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import assert from 'node:assert';
import ts from 'typescript';
import { getGeneratedReceiverOwner } from '../receiver';

type NamedDeclaration = ts.InterfaceDeclaration | ts.ClassDeclaration;
type MethodNode = ts.MethodSignature | ts.MethodDeclaration;

function collectNamedDeclarations(
  sourceFile: ts.SourceFile
): Map<string, NamedDeclaration[]> {
  const declarations = new Map<string, NamedDeclaration[]>();
  for (const statement of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      const name = statement.name.text;
      const named = declarations.get(name) ?? [];
      named.push(statement);
      declarations.set(name, named);
    }
  }
  return declarations;
}

function createInlineVisitor(
  ctx: ts.TransformationContext,
  inlines: Map<string, ts.TypeNode>
): ts.Visitor<ts.Node, ts.Node> {
  if (inlines.size === 0) return (node) => node;

  const visitor: ts.Visitor<ts.Node, ts.Node> = (node) => {
    node = ts.visitEachChild(node, visitor, ctx);
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName)) {
      return inlines.get(node.typeName.text) ?? node;
    }
    return node;
  };
  return visitor;
}

function getHeritageDeclaration(
  checker: ts.TypeChecker,
  declarations: Map<string, NamedDeclaration[]>,
  originalSuperType: ts.ExpressionWithTypeArguments,
  transformedSuperType: ts.ExpressionWithTypeArguments
): NamedDeclaration {
  const symbol = checker.getSymbolAtLocation(originalSuperType.expression);
  if (symbol !== undefined) {
    const symbolDeclarations = symbol.getDeclarations();
    assert.strictEqual(symbolDeclarations?.length, 1);
    const declaration = symbolDeclarations[0];
    assert(
      ts.isInterfaceDeclaration(declaration) ||
        ts.isClassDeclaration(declaration)
    );

    if (ts.isSourceFile(declaration.parent)) {
      const candidates = declarations.get(declaration.name.text);
      assert.strictEqual(
        candidates?.length,
        1,
        `Expected one transformed top-level declaration named ${declaration.name.text}, got ${candidates?.length ?? 0}`
      );
      return candidates[0];
    }
    return declaration;
  }

  assert(
    ts.isIdentifier(transformedSuperType.expression),
    'Expected checker resolution for qualified heritage expression'
  );
  const candidates = declarations.get(transformedSuperType.expression.text);
  assert.strictEqual(
    candidates?.length,
    1,
    `Expected one generated declaration named ${transformedSuperType.expression.text}, got ${candidates?.length ?? 0}`
  );
  return candidates[0];
}

function isStatic(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    ts
      .getModifiers(node)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ===
      true
  );
}

function methodName(node: MethodNode): string | undefined {
  return ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function createShadowMethod(
  ctx: ts.TransformationContext,
  member: MethodNode,
  inlineVisitor: ts.Visitor<ts.Node, ts.Node>,
  targetIsInterface: boolean
): MethodNode | undefined {
  const receiver = member.parameters[0];
  const ownerType = getGeneratedReceiverOwner(receiver);
  if (receiver === undefined || ownerType === undefined) return undefined;

  const receiverType = ctx.factory.createUnionTypeNode([
    ownerType,
    ctx.factory.createTypeQueryNode(ctx.factory.createIdentifier('globalThis')),
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
  const parameters = ctx.factory.createNodeArray([
    globalReceiver,
    ...member.parameters.slice(1),
  ]);

  const shadow: MethodNode = targetIsInterface
    ? ctx.factory.createMethodSignature(
        /* modifiers */ undefined,
        member.name,
        member.questionToken,
        member.typeParameters,
        parameters,
        member.type
      )
    : ctx.factory.createMethodDeclaration(
        member.modifiers,
        ts.isMethodDeclaration(member) ? member.asteriskToken : undefined,
        member.name,
        member.questionToken,
        member.typeParameters,
        parameters,
        member.type,
        /* body */ undefined
      );
  const inlined = ts.visitNode(shadow, inlineVisitor);
  assert(
    inlined !== undefined &&
      (ts.isMethodSignature(inlined) || ts.isMethodDeclaration(inlined))
  );
  return inlined;
}

function collectInheritedShadows(
  ctx: ts.TransformationContext,
  checker: ts.TypeChecker,
  declarations: Map<string, NamedDeclaration[]>,
  target: NamedDeclaration
): MethodNode[] {
  const shadows: MethodNode[] = [];
  const seen = new Set<string>();

  for (const member of target.members) {
    if (
      (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) &&
      !isStatic(member)
    ) {
      const name = methodName(member);
      if (name !== undefined) seen.add(name);
    }
  }

  function collect(
    node: NamedDeclaration,
    typeArgs?: ts.NodeArray<ts.TypeNode>
  ): void {
    const typeArgInlines = new Map<string, ts.TypeNode>();
    if (node.typeParameters !== undefined) {
      assert(
        node.typeParameters.length === typeArgs?.length,
        `Expected ${node.typeParameters.length} type argument(s), got ${typeArgs?.length}`
      );
      node.typeParameters.forEach((typeParam, index) => {
        typeArgInlines.set(typeParam.name.text, typeArgs[index]);
      });
    }
    const inlineVisitor = createInlineVisitor(ctx, typeArgInlines);

    const methods = new Map<string, MethodNode[]>();
    for (const member of node.members) {
      if (
        (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) &&
        !isStatic(member)
      ) {
        const name = methodName(member);
        if (name !== undefined) {
          const overloads = methods.get(name) ?? [];
          overloads.push(member);
          methods.set(name, overloads);
        }
      }
    }

    for (const [name, overloads] of methods) {
      if (seen.has(name)) continue;
      seen.add(name);
      for (const overload of overloads) {
        const shadow = createShadowMethod(
          ctx,
          overload,
          inlineVisitor,
          ts.isInterfaceDeclaration(target)
        );
        if (shadow !== undefined) shadows.push(shadow);
      }
    }

    if (node.heritageClauses === undefined) return;
    for (const originalClause of node.heritageClauses) {
      const transformedClause = ts.visitNode(
        originalClause,
        inlineVisitor,
        ts.isHeritageClause
      );
      assert.strictEqual(
        transformedClause.types.length,
        originalClause.types.length
      );
      transformedClause.types.forEach((superType, index) => {
        collect(
          getHeritageDeclaration(
            checker,
            declarations,
            originalClause.types[index],
            superType
          ),
          superType.typeArguments
        );
      });
    }
  }

  if (target.heritageClauses !== undefined) {
    for (const clause of target.heritageClauses) {
      clause.types.forEach((superType) => {
        collect(
          getHeritageDeclaration(checker, declarations, superType, superType),
          superType.typeArguments
        );
      });
    }
  }

  return shadows;
}

function updateMembers(
  ctx: ts.TransformationContext,
  node: NamedDeclaration,
  shadows: readonly MethodNode[]
): NamedDeclaration {
  if (shadows.length === 0) return node;
  if (ts.isInterfaceDeclaration(node)) {
    return ctx.factory.updateInterfaceDeclaration(
      node,
      node.modifiers,
      node.name,
      node.typeParameters,
      node.heritageClauses,
      ctx.factory.createNodeArray([
        ...(shadows as ts.MethodSignature[]),
        ...node.members,
      ])
    );
  }
  return ctx.factory.updateClassDeclaration(
    node,
    node.modifiers,
    node.name,
    node.typeParameters,
    node.heritageClauses,
    ctx.factory.createNodeArray([
      ...(shadows as ts.MethodDeclaration[]),
      ...node.members,
    ])
  );
}

/**
 * Shadows receiver-marked inherited methods on ServiceWorkerGlobalScope without
 * widening the shared ancestor declaration. Native workerd accepts nullish and
 * Worker-global receivers for methods reached through self, but ordinary object
 * instances such as EventTarget remain owner-bound.
 */
export function createWorkerGlobalMethodShadowTransformer(
  checker: ts.TypeChecker
): ts.TransformerFactory<ts.SourceFile> {
  return (ctx) => {
    return (sourceFile) => {
      const declarations = collectNamedDeclarations(sourceFile);
      const visitor: ts.Visitor = (node) => {
        if (
          (ts.isInterfaceDeclaration(node) ||
            ts.isClassDeclaration(node)) &&
          node.name?.text === 'ServiceWorkerGlobalScope'
        ) {
          return updateMembers(
            ctx,
            node,
            collectInheritedShadows(ctx, checker, declarations, node)
          );
        }
        return ts.visitEachChild(node, visitor, ctx);
      };
      return ts.visitEachChild(sourceFile, visitor, ctx);
    };
  };
}
