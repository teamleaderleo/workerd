// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import ts, { factory as f } from 'typescript';

// Generated nodes are printed and reparsed before transforms run, so receiver
// provenance cannot live solely on an AST object. This internal wrapper carries
// generated receiver policy through override replacement and global extraction.
// createReceiverCleanupTransformer() removes it from emitted declarations.
const GENERATED_RECEIVER_TYPE_NAME = '__JSG_GENERATED_RECEIVER__';

export function isThisParameter(
  parameter: ts.ParameterDeclaration | undefined
): parameter is ts.ParameterDeclaration {
  return (
    parameter !== undefined &&
    ts.isIdentifier(parameter.name) &&
    parameter.name.text === 'this'
  );
}

export function createGeneratedReceiverParameter(
  ownerType: ts.TypeNode
): ts.ParameterDeclaration {
  return f.createParameterDeclaration(
    /* modifiers */ undefined,
    /* dotDotDotToken */ undefined,
    'this',
    /* questionToken */ undefined,
    f.createTypeReferenceNode(GENERATED_RECEIVER_TYPE_NAME, [ownerType])
  );
}

export function getGeneratedReceiverOwner(
  parameter: ts.ParameterDeclaration | undefined
): ts.TypeNode | undefined {
  if (!isThisParameter(parameter) || parameter.type === undefined) {
    return undefined;
  }
  if (
    !ts.isTypeReferenceNode(parameter.type) ||
    !ts.isIdentifier(parameter.type.typeName) ||
    parameter.type.typeName.text !== GENERATED_RECEIVER_TYPE_NAME ||
    parameter.type.typeArguments?.length !== 1
  ) {
    return undefined;
  }
  return parameter.type.typeArguments[0];
}

export function updateGeneratedReceiverOwner(
  parameter: ts.ParameterDeclaration,
  ownerType: ts.TypeNode
): ts.ParameterDeclaration {
  return f.updateParameterDeclaration(
    parameter,
    parameter.modifiers,
    parameter.dotDotDotToken,
    parameter.name,
    parameter.questionToken,
    f.createTypeReferenceNode(GENERATED_RECEIVER_TYPE_NAME, [ownerType]),
    parameter.initializer
  );
}

function unwrapGeneratedReceiver(
  parameter: ts.ParameterDeclaration
): ts.ParameterDeclaration {
  const ownerType = getGeneratedReceiverOwner(parameter);
  if (ownerType === undefined) return parameter;
  return f.updateParameterDeclaration(
    parameter,
    parameter.modifiers,
    parameter.dotDotDotToken,
    parameter.name,
    parameter.questionToken,
    ownerType,
    parameter.initializer
  );
}

export function createReceiverCleanupTransformer(): ts.TransformerFactory<ts.SourceFile> {
  return (ctx) => {
    const visitor: ts.Visitor = (node) => {
      node = ts.visitEachChild(node, visitor, ctx);
      if (ts.isParameter(node)) return unwrapGeneratedReceiver(node);
      return node;
    };
    return (sourceFile) => ts.visitEachChild(sourceFile, visitor, ctx);
  };
}
