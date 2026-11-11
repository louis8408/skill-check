/**
 * Layer rules (Clean Architecture). Enforced by tests/architecture and `npm run depcruise`.
 *   domain          -> nothing (no node:*, no npm packages, no other layer)
 *   application     -> domain only
 *   infrastructure  -> domain (+ node builtins, npm packages); never application or presentation
 *   presentation    -> anything; it is the composition root
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-is-pure',
      severity: 'error',
      comment: 'Domain must not depend on other layers, node builtins or npm packages.',
      from: { path: '^src/domain' },
      to: {
        pathNot: '^src/domain',
      },
    },
    {
      name: 'application-depends-only-on-domain',
      severity: 'error',
      comment: 'Application code depends only on domain abstractions.',
      from: { path: '^src/application' },
      to: { pathNot: '^src/(domain|application)' },
    },
    {
      name: 'infrastructure-not-on-application-or-presentation',
      severity: 'error',
      comment: 'Infrastructure implements domain ports; it never reaches up into application or presentation.',
      from: { path: '^src/infrastructure' },
      to: { path: '^src/(application|presentation)' },
    },
    {
      name: 'infrastructure-only-from-composition-root',
      severity: 'error',
      comment: 'Concrete infrastructure is referenced only by the composition root (src/presentation).',
      from: { pathNot: '^src/(presentation|infrastructure)' },
      to: { path: '^src/infrastructure' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // node builtins and npm packages stay in the graph (so the domain/application
    // rules can see them) but are not followed.
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.js'] },
  },
};
