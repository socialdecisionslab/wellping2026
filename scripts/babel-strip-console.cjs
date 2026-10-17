// Release bundles must not evaluate or emit application/dependency diagnostics.
module.exports = ({ types: t }) => ({
  name: "wellping-strip-release-console",
  visitor: {
    CallExpression(path) {
      const callee = path.node.callee;
      if (
        t.isMemberExpression(callee) &&
        t.isIdentifier(callee.object, { name: "console" })
      ) {
        path.replaceWith(t.unaryExpression("void", t.numericLiteral(0)));
      }
    },
  },
});
