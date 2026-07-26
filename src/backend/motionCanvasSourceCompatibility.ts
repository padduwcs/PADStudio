import ts from 'typescript';

export const MOTION_CANVAS_TRANSPARENT_COLOR = '#00000000';

const colorPropertyNames = new Set([
  'color',
  'fill',
  'shadowColor',
  'stroke',
]);

interface SourceReplacement {
  start: number;
  end: number;
  value: string;
}

interface SourceBinding {
  declaration: ts.Node;
  value: ts.Node;
  scope: ts.Node;
  hoisted: boolean;
}

function propertyNameText(name: ts.PropertyName) {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return null;
}

function isTransparentLiteral(
  node: ts.Node | undefined,
): node is ts.StringLiteralLike {
  return Boolean(
    node &&
    (ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)) &&
    node.text.trim().toLocaleLowerCase('en-US') === 'transparent'
  );
}

function colorLiteralNodes(sourceFile: ts.SourceFile) {
  const matches = new Set<ts.StringLiteralLike>();
  const bindings = new Map<string, SourceBinding[]>();

  function lexicalScope(node: ts.Node) {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (ts.isBlock(current) || ts.isSourceFile(current)) {
        return current;
      }
      current = current.parent;
    }
    return sourceFile;
  }

  function addBinding(name: string, binding: SourceBinding) {
    const current = bindings.get(name) ?? [];
    current.push(binding);
    bindings.set(name, current);
  }

  function collectBindings(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      addBinding(node.name.text, {
        declaration: node,
        value: node.initializer,
        scope: lexicalScope(node),
        hoisted: false,
      });
    } else if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.body
    ) {
      addBinding(node.name.text, {
        declaration: node,
        value: node.body,
        scope: lexicalScope(node),
        hoisted: true,
      });
    }
    ts.forEachChild(node, collectBindings);
  }

  function resolveBinding(identifier: ts.Identifier) {
    const referenceStart = identifier.getStart(sourceFile);
    return (bindings.get(identifier.text) ?? [])
      .filter(
        (binding) =>
          binding.scope.pos <= identifier.pos &&
          binding.scope.end >= identifier.end &&
          (binding.hoisted ||
            binding.declaration.getStart(sourceFile) <= referenceStart),
      )
      .sort((left, right) => {
        const leftScopeWidth = left.scope.end - left.scope.pos;
        const rightScopeWidth = right.scope.end - right.scope.pos;
        return (
          leftScopeWidth - rightScopeWidth ||
          right.declaration.getStart(sourceFile) -
            left.declaration.getStart(sourceFile)
        );
      })[0];
  }

  function collectColorValue(
    node: ts.Node | undefined,
    visitedBindings = new Set<ts.Node>(),
  ) {
    if (!node) return;
    if (isTransparentLiteral(node)) {
      matches.add(node);
      return;
    }
    if (ts.isIdentifier(node)) {
      const binding = resolveBinding(node);
      if (binding && !visitedBindings.has(binding.declaration)) {
        visitedBindings.add(binding.declaration);
        collectColorValue(binding.value, visitedBindings);
        visitedBindings.delete(binding.declaration);
      }
      return;
    }
    ts.forEachChild(node, (child) =>
      collectColorValue(child, visitedBindings),
    );
  }

  function collectColorContexts(node: ts.Node) {
    if (ts.isJsxAttribute(node)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : null;
      if (name && colorPropertyNames.has(name)) {
        if (
          node.initializer &&
          ts.isJsxExpression(node.initializer)
        ) {
          collectColorValue(node.initializer.expression);
        } else {
          collectColorValue(node.initializer);
        }
      }
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      colorPropertyNames.has(node.expression.name.text)
    ) {
      collectColorValue(node.arguments[0]);
    } else if (
      ts.isPropertyAssignment(node) &&
      colorPropertyNames.has(propertyNameText(node.name) ?? '')
    ) {
      collectColorValue(node.initializer);
    } else if (
      (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Color'
    ) {
      collectColorValue(node.arguments?.[0]);
    }

    ts.forEachChild(node, collectColorContexts);
  }

  collectBindings(sourceFile);
  collectColorContexts(sourceFile);
  return [...matches];
}

export function findUnsupportedMotionCanvasColorLiterals(
  source: string,
): string[] {
  const sourceFile = ts.createSourceFile(
    'motion-canvas-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return colorLiteralNodes(sourceFile).map((node) =>
    node.getText(sourceFile),
  );
}

/**
 * Motion Canvas 3.17 delegates string parsing to chroma-js 2.4, which does
 * not accept the CSS keyword `transparent`. An eight-digit hex color has the
 * same semantics and is accepted by both Motion Canvas and the Layout Editor.
 */
export function normalizeMotionCanvasColorFormats(source: string) {
  const sourceFile = ts.createSourceFile(
    'motion-canvas-scene.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const replacements: SourceReplacement[] = colorLiteralNodes(sourceFile).map(
    (node) => ({
      start: node.getStart(sourceFile),
      end: node.getEnd(),
      value: JSON.stringify(MOTION_CANVAS_TRANSPARENT_COLOR),
    }),
  );

  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, replacement) =>
        `${result.slice(0, replacement.start)}${replacement.value}${result.slice(replacement.end)}`,
      source,
    );
}
