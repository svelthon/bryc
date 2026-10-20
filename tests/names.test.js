// @vitest-environment node
//
// What a name of the module may be, and what a source may import: a word
// JavaScript reserves, a name a JavaScript import brings, a word the host
// reserves, and a module that does not ship.
import { test, expect } from 'vitest';
import * as bryc from '../../src/lib/bryc/bryc.js';

const host = {
    name: 'host',
    runtime: { bind: 'bind', jsCall: 'jsCall', readOnlyImport: 'readOnly' },
    reserved: {
        words: [
            { name: 'derived', component: false },
            { name: 'export', component: true }
        ],
        said: 'Its helpers may still be shadowed.'
    },
    instead: { json: '`load(text)` reads JSON' }
};
const source = 'src/a.py';
const P = bryc.PROTO;

// **What the generated module cannot bind is refused on the line that binds
// it**, under the host's name: a word JavaScript reserves, with the trailing
// underscore Python's convention gives it, and a name a JavaScript import
// brings, which Python reads and never binds, at the module's top level or in
// a function that declares it `global`, and not where a function binds a name
// of its own.
test('a word JavaScript reserves is refused on its line, with the name Python writes instead', () => {
    expect(() => bryc.refuseReserved(host, ['default'], source, new Map([['default', 2]]), 3)).toThrow(
        /^host — `default` is a reserved word in JavaScript, and the generated module cannot bind one \(src\/a\.py:5\)\. .* `default_`\.$/
    );
    expect(() => bryc.refuseReserved(host, [], source, new Map())).not.toThrow();
});

const bound = (src) => {
    const ast = bryc.compilePython(host, src, { name: 'a', source })._ast;

    return () => bryc.refuseBoundImports(host, ast, bryc.symbolTable(ast, source), ['navigate'], source, 10);
};

test("a JavaScript import bound by the module, or by a function's `global`, is refused on its line", () => {
    expect(bound('x = 1\nnavigate = 2\n')).toThrow(/^host — `navigate` is a JavaScript import, which Python reads and never binds, .* \(src\/a\.py:12\)/);
    expect(bound('def go():\n    global navigate\n    navigate = 1\n')).toThrow(/\(src\/a\.py:13\)/);
});

test("a function's own name of that spelling binds nothing of the module's", () => {
    expect(bound('def go():\n    navigate = 1\n    return navigate\n')).not.toThrow();
});

// **A name JavaScript gives the module is published to Python under the name
// Python reads**, on the namespace's accessors through the host's runtime:
// read afresh at every access, an import read-only, as JavaScript holds it. A
// name Python declares itself wins, each is published once, and two names
// Python reads as one are refused, under the host's name.
test('an import read-only, a name of the JavaScript beside the module read and written', () => {
    const lines = bryc.jsNameBindings(host, { jsImported: ['navigate'], declared: ['total'], source }, ['total', 'amount', 'navigate']);

    expect(lines).toEqual([
        `bind(${P}, 'navigate', () => jsCall(navigate), () => readOnly("navigate", "src/a.py"));`,
        `bind(${P}, 'amount', () => jsCall(amount));`
    ]);
});

test('under the name Python reads', () => {
    expect(bryc.jsNameBindings(host, { jsImported: [], declared: [], source: 'a.py' }, ['ﬁeld'])).toEqual([`bind(${P}, 'field', () => jsCall(ﬁeld));`]);
});

test('two names Python reads as one are refused', () => {
    expect(() => bryc.jsNameBindings(host, { jsImported: [], declared: [], source: 'a.py' }, ['field', 'ﬁeld'])).toThrow(
        /^host — `field` and `ﬁeld` are two JavaScript names Python reads as one, `field` \(a\.py\)/
    );
});

// **A word the host reserves is refused where the author takes it**, under the
// host's name, on the line the name was bound, and ends on what the host says:
// a component's word only in a component, and any other everywhere. A word the
// host does not reserve is the author's.
const lines = new Map([['derived', 3]]);

const refusal = (declared, component) => {
    try {
        bryc.refuseHostWords(host, declared, component, source, lines, 10);
    } catch (error) {
        return error;
    }

    return null;
};

test('a reserved word is refused on its line, under the host name, ending on what the host says', () => {
    const error = refusal(['total', 'derived'], false);

    expect(error.message).toBe("host — `derived` is one of Host's own words and cannot be redefined (src/a.py:13). Its helpers may still be shadowed.");
    expect(error.start).toEqual({ line: 13, column: 0 });
});

test("a component's word is free in a module, and refused in a component, said with the file when no line is known", () => {
    expect(refusal(['export'], false)).toBe(null);
    expect(refusal(['export'], true).message).toMatch(/^host — `export` is one of Host's own words and cannot be redefined \(src\/a\.py\)\./);
});

test("a word the host does not reserve is the author's", () => {
    expect(refusal(['effect', 'total'], true)).toBe(null);
});

// **A module that does not ship is refused on the line that imports it**,
// under the host's name, with what the host says stands in for it. A module
// the runtime holds, or a file of the project, is imported as written.
const missing = (module, resolves = () => undefined) => () =>
    bryc.refuseMissingModules(host, new Map([[module, 2]]), resolves, source, 10);

test('a module that does not ship is refused on its line, with what the host says stands in for it', () => {
    expect(missing('json')).toThrow(
        /^host — `json` is not a module a component can import: Python's standard library does not ship, .*; `load\(text\)` reads JSON \(src\/a\.py:12\)$/
    );
    expect(missing('csv')).toThrow(/the project's own `\.py` files do \(src\/a\.py:12\)$/);
    expect(missing('browser')).not.toThrow();
    expect(missing('cart', () => 'file')).not.toThrow();
});
