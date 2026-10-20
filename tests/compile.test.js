// @vitest-environment node
//
// What a compile hands back: Brython's translation of the source, a Python
// error made a refusal on its line, the source map, the module that holds the
// code and the namespace it runs in, how a name of the module is held, and a
// component's Python, its script with the template's functions after it.
import { test, expect } from 'vitest';
import * as bryc from '../../src/lib/bryc/bryc.js';

// A host that makes a state as Vue does, a ref its `triggerRef` moves.
const host = {
    name: 'host',
    bridge: 'host/bridge',
    runtime: {
        jsGlobal: 'globalThis',
        bind: 'bind',
        SHAPING: 'SHAPING',
        followOwn: 'followOwn',
        track: 'track',
        changesNothing: 'changesNothing'
    },
    state: {
        cell: (name, cell, bumped) => [`const ${cell} = shallowRef(undefined);`, `const ${bumped} = () => triggerRef(${cell});`],
        value: (cell) => `${cell}.value`,
        read: (name, cell) => `${cell}.value`,
        write: (cell, value) => `${cell}.value = ${value}`
    }
};
const NS = bryc.NS;
const next = bryc.NEXT_VALUE;

// **A name JavaScript gives the module is read as the module reads its own**,
// even spelled like a builtin: `max` imported from JavaScript and then called
// is the import, as `from m import max` is in Python, where Brython would take
// a name nothing in the module binds for the builtin. A name that is no
// builtin, and a source with none, compile as written.
const options = { name: 'probe', source: 'src/probe.py', src: 'x = max(1, 2)\n' };
const root = () => bryc.compilePython(host, options.src, options);

test("a JavaScript name spelled like a builtin is read off the module's namespace", () => {
    const js = bryc.translation(host, root(), ['max'], options);

    expect(js).toContain("$B.resolve_global('max'");
    expect(js).not.toContain('_b_.max');
});

test('a name that is no builtin leaves the code as Brython wrote it', () => {
    const written = root().to_js();

    expect(bryc.translation(host, root(), ['shuffle'], options)).toBe(written);
    expect(written).toContain('_b_.max');
});

// **A Python error at compile time is a refusal on the line of the file that
// holds it**: Brython's own message, under the host's name, at the Python line
// moved by what stands before the Python in its file, on the error object as
// an editor reads it as well as in the sentence. In a template's function it is
// the markup's line and column, with the expression quoted and what Python
// writes instead of the JavaScript in it.
const refusal = (text, options) => {
    try {
        bryc.compilePython(host, text, { name: 'probe', source: 'src/probe.py', ...options });
    } catch (error) {
        return error;
    }

    throw new Error('compiled');
};

test('a syntax error is refused at its line, moved by what stands before the Python', () => {
    const error = refusal('x = 1\ny = (\n', { lineOffset: 10 });

    expect(error).toBeInstanceOf(SyntaxError);
    expect(error.message).toMatch(/^host — SyntaxError: .* \(src\/probe\.py:12\)$/);
    expect(error.filename).toBe('src/probe.py');
    expect(error.start).toEqual({ line: 12, column: 0 });
});

test("an error in a template's function is refused at the markup, the expression quoted", () => {
    // The function stands on Python lines 3 to 4, and its expression on line 7,
    // column 5, of the markup.
    const text = 'x = 1\n\ndef __expr_0():\n    return __text(a ? b : c)\n';
    const error = refusal(text, { ranges: [[3, 4, 7, 4]] });

    expect(error.message).toMatch(/^host — SyntaxError: .* \(src\/probe\.py:7:5\)\n {2}in the template expression `a \? b : c`, which is Python: `a \? b : c` is `b if a else c`\.$/);
    expect(error.start).toEqual({ line: 7, column: 4 });
});

test('a source that compiles is Brython\'s translation of it', () => {
    const root = bryc.compilePython(host, 'total = 1 + 2\n', { name: 'probe', source: 'src/probe.py' });

    expect(root.to_js()).toContain('$B.set_lineno(frame, 1)');
});

// **Each line of the generated code maps to the Python line it came from**,
// which Brython writes into the code as `$B.set_lineno(frame, N)`: from that
// call on, every generated line is the line N of the Python, moved by the lines
// that stand before the Python in its file. A line before the first call maps
// to nothing.
const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// The source line of each generated line, by reading the map back as a source
// map is read: base-64 VLQ, each field a delta from the one before.
const originalLines = (mappings) => {
    let line = 0;

    return mappings.split(';').map((segment) => {
        if (segment === '') return null;

        const fields = [];
        let value = 0;
        let shift = 0;

        for (const char of segment) {
            const digit = DIGITS.indexOf(char);

            value += (digit & 31) << shift;
            shift += 5;

            if (!(digit & 32)) {
                fields.push(value & 1 ? -(value >> 1) : value >> 1);
                value = 0;
                shift = 0;
            }
        }

        line += fields[2];
        return line;
    });
};

test('a generated line maps to the Python line it came from, moved by what stands before the Python', () => {
    const generated = [
        'var $B = __BRYTHON__',
        '$B.set_lineno(frame, 1)',
        'x = 1',
        '$B.set_lineno(frame, 4)',
        'y = 2'
    ].join('\n');
    const map = bryc.sourceMap(generated, 'src/Card.py', 'the source', 10);

    expect(map).toMatchObject({ version: 3, sources: ['src/Card.py'], sourcesContent: ['the source'], names: [] });
    // Zero-based, as a map counts: Python's line 1 is the file's line 11.
    expect(originalLines(map.mappings)).toEqual([null, 10, 10, 13, 13]);
});

test('a line before any Python line maps to nothing', () => {
    expect(originalLines(bryc.sourceMap('a\nb', 'm.py', '', 0).mappings)).toEqual([null, null]);
});

// **The code Brython generated lives in a module of its own**, which imports
// its runtime from the host's bridge, under the names the host's runtime gives
// it, and runs the Python body inside the namespace it is handed: a Python
// exception comes out as the runtime makes it, said for the source. And the
// namespace the code opens is the one Bryc names for the file, or the module
// Python imports it by.
//
// A host whose generated names share no scope with the author's, as a Vue
// component's do not, and one whose do, as a Svelte script's.
const plain = { name: 'host', bridge: 'host/bridge', runtime: { withNamespace: 'withNamespace', pyError: 'pyError' } };
const prefixed = { ...plain, runtime: { withNamespace: '__withNamespace', pyError: '__pyError' } };

test('the module imports its runtime from the bridge, under the names the host gives it', () => {
    const code = (host) => bryc.moduleCode(host, { js: 'BODY', namespace: 'src/a_py', source: 'src/a.py' }).split('\n');

    expect(code(plain)).toEqual([
        "import { withNamespace, pyError } from 'host/bridge';",
        '',
        `export function init(${NS}) {`,
        '  try {',
        `    return withNamespace("src/a_py", ${NS}, () => {`,
        'BODY',
        '    });',
        '  } catch (err) { throw pyError(err,"src/a.py"); }',
        '}'
    ]);
    expect(code(prefixed)[0]).toBe("import { withNamespace as __withNamespace, pyError as __pyError } from 'host/bridge';");
    expect(code(prefixed)[4]).toBe(`    return __withNamespace("src/a_py", ${NS}, () => {`);
});

test('the namespace is the file, or the module Python imports it by', () => {
    const js = (namespace) => bryc.compilePython(plain, 'x = 1\n', { name: 'a', source: 'src/a.py', named: namespace }).to_js();

    expect(bryc.moduleNamespace(plain, js(null), 'src/a.py')).toBe('src/a_py');
    expect(bryc.moduleNamespace(plain, js('shop-cart'), 'src/a.py', 'shop-cart')).toBe('shop_cart');
});

test('code that opens no namespace Bryc can hook is refused, under the host name', () => {
    expect(() => bryc.moduleNamespace(plain, 'var x = 1', 'src/a.py')).toThrow(/^host: the code generated for src\/a\.py never calls \$B\.namespace\("src\/a_py"\)/);
});

// **A compile runs the common half in its order, the host's own syntax made
// Python before the translation** (`host.rewrite`): a host that writes `TWO`
// for `2` has it rewritten, told which names `importjs` binds, and a host with
// no syntax of its own has the text compiled as it is.
test("the host's rewrite runs before the translation, and a host with none leaves the text", () => {
    const told = [];
    const rewriting = {
        ...plain,
        rewrite: (text, { bound }) => {
            told.push([...bound]);
            return text.replace('TWO', '2');
        }
    };
    const options = { name: 'a', source: 'src/a.py', component: true };
    const compiled = bryc.compile(rewriting, 'importjs { shuffle } from "lodash"\nx = TWO\n', options);

    expect(compiled.src).toBe('\nx = 2\n');
    expect(told).toEqual([['shuffle']]);
    expect(compiled.jsImported).toEqual(['shuffle']);
    expect(compiled.module).toContain(`return withNamespace("src/a_py", ${NS}, () => {`);
    expect(bryc.compile(plain, 'x = TWO\n', options).src).toBe('x = TWO\n');
});

// **The namespace a Python body runs in is a view of the accessors it inherits**:
// made from them through the host's runtime, flagged `$proxy` so that Brython
// reads a global through the prototype chain, and known to Python by its
// module's name. One a body may replace is declared so.
test('made from the accessors, flagged and named', () => {
    expect(bryc.namespaceObject(host, { name: 'shop' })).toEqual([
        `const ${NS} = globalThis.Object.create(${bryc.PROTO});`,
        `${NS}.$proxy = true;`,
        `${NS}.__name__ = "shop";`
    ]);
});

test('one a body may replace is a `let`', () => {
    expect(bryc.namespaceObject(host, { name: 'shop', replaced: true })[0]).toBe(`let ${NS} = globalThis.Object.create(${bryc.PROTO});`);
});

// **A name of the module is a cell the host makes one of its states, behind an
// accessor Bryc writes**: the accessor reads the cell so that a change in place
// moves its readers, follows the cell itself for the rows of a template's loop,
// and writes through `track`, unless the write changes nothing.
test('the cell is the host\'s state, with the bump that moves its readers', () => {
    expect(bryc.stateCell(host, 'count', '__ref_count')).toEqual([
        'const __ref_count = shallowRef(undefined);',
        'const __bump_count = () => triggerRef(__ref_count);'
    ]);
});

test('the accessor reads and writes the cell as the host does, through track', () => {
    expect(bryc.stateBinding(host, 'count', '__ref_count')).toBe(
        `bind(${bryc.PROTO}, 'count', () => (SHAPING.on ? followOwn(__ref_count.value) : __ref_count.value), ` +
            `(${next}) => { const __was = __bump_count.held; const __written = track(${next}, __bump_count);` +
            ` if (!changesNothing(__written, __was)) __ref_count.value = __written; });`
    );
});

test("an instance signs its containers onto its own list, and a function's accessor hands what it holds", () => {
    const line = bryc.stateBinding(host, 'go', '__fn_go', { subs: '__subs', held: '__fn_go' });

    expect(line).toContain(`track(${next}, __bump_go, __subs)`);
    expect(line.endsWith(' }, () => __fn_go);')).toBe(true);
});

// **A component's Python is its script, dedented, with the template's
// functions after it**: the block an author indents inside the markup is
// taken back to column zero as Brython takes a `<script type="text/python">`,
// each function's dot reads a key as well as an attribute, and Bryc says where
// each function lands, at the markup line and column it stands for.
test('the script dedented, the functions after it, each where its markup stands', () => {
    const defs = ['def __expr_0(row):\n    return __text(row.name)', 'def __expr_1():\n    return __text(1)'];
    const { src, ranges, templateLine } = bryc.componentSource('    x = 1\n\n    y = 2', defs, [12, 14], [4, 0]);

    expect(src).toBe(
        'x = 1\n\ny = 2\n' +
            'def __expr_0(row):\n    return __text(__getattr(row, "name"))\n\n' +
            'def __expr_1():\n    return __text(1)\n'
    );
    // Python lines 4 to 5 and 7 to 8, the markup's line 12, column 4, and 14.
    expect(ranges).toEqual([
        [4, 5, 12, 4],
        [7, 8, 14, 0]
    ]);
    expect(templateLine).toBe(4);
});

test('a script with no template functions is the script, dedented', () => {
    expect(bryc.componentSource('    x = 1', [])).toEqual({ src: 'x = 1', ranges: [], templateLine: undefined });
});
