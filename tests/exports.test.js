// @vitest-environment node
//
// What a module exports: the list `__all__` declares, what of it the module
// cannot export, each name exported live, and the body run when the module is
// imported.
import { test, expect } from 'vitest';
import * as bryc from '../../src/lib/bryc/bryc.js';

const host = {
    name: 'host',
    runtime: { jsGlobal: 'globalThis', liveExport: 'liveExport', pyExport: 'pyExport', pythonModule: 'pythonModule' }
};
const NS = bryc.NS;
const next = bryc.NEXT_VALUE;

// **What a module exports is what `__all__` holds once its top-level
// statements have run**, as `from m import *` obeys it: each statement that
// writes it is run as Python runs it when it is written with literals,
// `__all__` and the builtins that only read, the last one counts, an entry
// that is not a string is left out, a name listed twice is exported once. A
// write a static reading cannot follow is refused, under the host's name, on
// its line. No `__all__`, no list.
const source = 'src/probe.py';

const exported = (src, lineOffset = 0) => {
    const ast = bryc.compilePython(host, src, { name: 'probe', source })._ast;

    return bryc.declaredExports(host, ast, bryc.symbolTable(ast, source), source, lineOffset, src);
};

test('the list the module ends with, run as Python runs it', () => {
    const src = [
        'def load(): pass',
        'def save(): pass',
        '__all__ = ["gone"]',
        '__all__ = ["load", "save", 3]',
        '__all__ += sorted(["load"])'
    ].join('\n');

    // The last list, its number left out and its `load` exported once, at the
    // line of the statement that last set it.
    expect(exported(src, 4)).toEqual({ names: ['load', 'save'], line: 9 });
});

test('a string is a list of its characters, as `+=` makes it', () => {
    expect(exported('__all__ = ["a"]\n__all__ += "bc"\n').names).toEqual(['a', 'b', 'c']);
});

test('no `__all__`, no list, and one that `del` removes is none either', () => {
    expect(exported('def load(): pass\n')).toBe(null);
    expect(exported('__all__ = ["load"]\ndel __all__\n')).toBe(null);
});

test('a list computed from a name is refused on its line, under the host\'s name', () => {
    let error;

    try {
        exported('names = ["load"]\n__all__ = names\n', 10);
    } catch (caught) {
        error = caught;
    }

    expect(error.message).toMatch(/^host — `__all__` is computed from `names`, and the export list is read from the source/);
    expect(error.start).toEqual({ line: 12, column: 0 });
});

test('a raise at import is refused where it is raised', () => {
    expect(() => exported('__all__ = ("load",)\n__all__.append("x")\n')).toThrow(
        /^host — Python raises `AttributeError: 'tuple' object has no attribute 'append'` here when the module is imported, so `__all__` has no value to export \(src\/probe\.py:2\)$/
    );
});

// **What `__all__` lists that the module cannot export is refused at the line
// of the list**, under the host's name: a name the module never binds, a word
// JavaScript reserves, a text that is no name. With a `from m import *`, a name
// not yet bound waits, and is refused once the body has run if the star did not
// bring it.
const checks = (names, more = {}) =>
    bryc.exportChecks(host, {
        declaration: { names, line: 4 },
        declared: ['load'],
        binds: new Set(['save']),
        jsImported: ['navigate'],
        starred: false,
        source: 'src/a.py',
        ...more
    });

test('a list of names the module binds, declares or imports is exported as it stands', () => {
    expect(checks(['load', 'save', 'navigate'])).toEqual({ unbound: [], line: 4, listedAt: 'src/a.py:4' });
    expect(checks(null, { declaration: null })).toEqual({ unbound: [], line: undefined, listedAt: 'src/a.py' });
});

test('a name the module never binds is refused at the list', () => {
    expect(() => checks(['load', 'lost'])).toThrow(/^host — `__all__` names `lost`, which this module never binds \(src\/a\.py:4\)\./);
});

test('a word JavaScript reserves, or a text that is no name, cannot be exported under it', () => {
    expect(() => checks(['default'], { binds: new Set(['default']) })).toThrow(/names `default`, which JavaScript reserves, so the module cannot export it/);
    expect(() => checks(['two words'], { starred: true })).toThrow(/names `two words`, which is not a name/);
});

test('with a star import, a name not yet bound waits, and is refused once the body has run', () => {
    const { unbound, listedAt } = checks(['load', 'later'], { starred: true });

    expect(unbound).toEqual(['later']);
    expect(bryc.unboundRefusals(host, unbound, listedAt)).toEqual([
        `if (${NS}["later"] === undefined) throw new globalThis.Error(${JSON.stringify(
            'host — `__all__` names `later`, which this module never binds (src/a.py:4). A module exports what it defines: check the spelling, or remove it from the list.'
        )});`
    ]);
});

// **A module exports by name, live**: each name a variable of its own, filled
// as the body binds it, the value crossing as the host's runtime hands Python's
// values to JavaScript; a name only JavaScript brings re-exported as
// JavaScript's own binding; and no default export. A module that exports
// nothing writes no `export`.
const module = { exported: ['load', 'navigate'], jsImported: ['navigate'], source: 'src/+page.server.py' };

test('each name exported live, a JavaScript import as its own binding', () => {
    expect(bryc.moduleExports(module)).toEqual(['let __export_load;', 'export { __export_load as load, navigate };']);
    expect(bryc.liveExportLines(host, module)).toEqual([
        `liveExport(${NS}, "load", (__value) => { __export_load = pyExport(__value, "load — src/+page.server.py"); });`
    ]);
});

test('a module that exports nothing writes no export', () => {
    expect(bryc.moduleExports({ exported: [], jsImported: [] })).toEqual([]);
});

// **A module's body runs when it is imported, not when it is evaluated**: a
// function the module exports by default, published under the module's Python
// name, runs what the host hands it, and takes a new namespace when a body that
// raised is imported again, with what the host renews beside it. An eager
// module runs it as it is evaluated, and exports no default. A name no
// `import` can write is published under none.
test('a default export that runs the body when the module is imported', () => {
    expect(bryc.moduleLoad(host, { name: 'cart', run: [`init(${NS});`, '', 'done();'], renewed: ['roots = fresh();'] })).toEqual([
        '',
        `export default pythonModule(${NS}, "cart", (${next}) => { ${NS} = ${next}; roots = fresh(); }, () => {`,
        `    init(${NS});`,
        '',
        '    done();',
        '});'
    ]);
});

test('an eager module runs it as it is evaluated, and a name no import writes is none', () => {
    const lines = bryc.moduleLoad(host, { name: '+page.server', eager: true, run: ['go();'] });

    expect(lines[1]).toBe(`pythonModule(${NS}, null, (${next}) => { ${NS} = ${next}; }, () => {`);
    expect(lines.at(-1)).toBe('})();');
});
