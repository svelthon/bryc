// The common half of a compile: Python made JavaScript by Brython, the same
// code on every run, the module that holds it and the namespace it runs in,
// the source map, how a name of the module is held, and what a name of the
// generated module may be.
import { pythonError, refuse } from './errors.js';

// The engine Bryc compiles on, which Bryntime starts, with the parsing chain it
// ships beside it, Brython's parser, its symbol table and its code generator:
// the door loads both, in that order, before any file of Bryc runs.
export const engine = () => globalThis.__BRYTHON__;

// Brython numbers what it generates from a counter that starts at random, so
// the same source would compile to different code on every run. Started from
// a number drawn from a text instead, a compile gives the same code each time:
// a number below 2 ** 50, the range of Brython's own random start, two FNV-1a
// hashes of the text, 18 bits of one above 32 of the other.
function counterStart(text) {
    const fnv = (basis) => {
        let hash = basis;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0;
        return hash;
    };

    return (fnv(0x811c9dc5) & 0x3ffff) * 2 ** 32 + fnv(0x050c5d1f);
}

// Brython's translation of `text`, the Python of `source`.
//
// `named` is the name Python imports the module by, or null for a file nobody
// imports, which keeps its path. `src` is the source as the author's lines
// stand, registered for Brython to quote, and `authored`, `ranges` and
// `lineOffset` say where a Python error stands in the file (`pythonError`).
function compilePython(host, text, { name, source, named = null, lineOffset = 0, authored = '', ranges = [], src = text }) {
    const $B = engine();

    // Brython reads the source back out of this cache to quote the offending
    // line, and `compiler_error` does it without checking: an unregistered
    // filename turns every *compile* error, as opposed to a parse error, which
    // takes another path, into `Cannot read properties of undefined (reading
    // 'split')`. That covers `await` outside a coroutine, `return` and `yield`
    // outside a function, `break` and `continue` outside a loop: the mistakes a
    // beginner actually makes. Registering the source is all it takes to get
    // Brython's own message, which is CPython's.
    $B.file_cache[source] = src;

    // Brython numbers the functions and lambdas it generates from a counter
    // and a tag it draws at random, so that modules compiled apart are
    // unlikely to share a name. Drawn from the file's path instead, they
    // keep that and give one file the same code in every build. Both are
    // given back afterwards, so a page that compiles leaves Brython's own
    // sequence where it was.
    const counter = $B.id_counter(counterStart(source));
    const tag = $B.lambda_magic;
    $B.lambda_magic = counterStart(`${source}#lambda`).toString(36).slice(0, 8);

    // Brython names a module after its file unless `$B.url2name` maps the file
    // to a name, which is how its own importer names what it imports. A module
    // is named as `import` finds it, so `__name__` and the `__module__` of what
    // it defines are that name, and `__file__` stays the path.
    const mapped = $B.url2name[source];
    if (named !== null) $B.url2name[source] = named;

    try {
        return $B.py2js({ src: text, filename: source }, name, [name]);
    } catch (error) {
        throw pythonError(host, error, source, lineOffset, authored, ranges, src);
    } finally {
        $B.id_counter(counter);
        $B.lambda_magic = tag;
        if (mapped === undefined) delete $B.url2name[source];
        else $B.url2name[source] = mapped;
    }
}

// The JavaScript of `root`, a compile of `options.src` (`compilePython`), in
// which `names`, the names JavaScript gives the module, are read as the module
// reads its own.
//
// A JavaScript name spelled like a builtin, `importjs { max }` then `max(…)`,
// is the import, as `from m import max` is in Python. Brython takes a name
// nothing in the module binds for the builtin, at compile time, and the
// bindings the host makes are not Python's. So the module is compiled again
// with a binding of those names that never runs, and reads each at run time,
// the module's first and the builtins after, as it reads any name the module
// binds. What was read off `root` stays on what the author wrote.
function translation(host, root, names, options) {
    const $B = engine();
    const shadowing = [...new Set(names.map(pythonKey))].filter(
        (n) => n in $B.builtins && /^[A-Za-z_]\w*$/.test(n) && !['None', 'True', 'False', '__debug__'].includes(n)
    );

    return (
        shadowing.length ? compilePython(host, `${options.src}\nif False:\n    ${shadowing.join(' = ')} = None\n`, options) : root
    ).to_js();
}

// Name the generated module gives to the reactive namespace it receives.
const NS = '__py';

// Brython emits module state into a namespace object:
//     locals_Counter = $B.namespace('Counter')
//     locals_Counter.count = 0
// Nothing lives in a lexical binding, so there is a single call to intercept,
// which the runtime does at execution time. This pattern is only checked, never
// rewritten; if a future codegen stops emitting it, compilation fails loudly
// instead of producing a component with no reactivity at all.
// The literal is Brython's own spelling, since this is both what is written
// beside its code and the needle the check below looks for in it. A path may
// hold a quote (`src/O'Brien.svelte` is a legal filename), so it is escaped
// rather than pasted, on both sides of the bridge, for the generated module to
// parse whatever the path.
const namespaceCall = (name) => `$B.namespace(${JSON.stringify(name)})`;

// The module id Brython derives for a file (`init_scopes`): the name
// `$B.url2name` maps the file to, with '-' made '_', or else the filename with
// '.' made '_'. It ends up as a *string*, the argument to $B.namespace and the
// frame name, so a '/' is harmless there. The identifier built beside it is a
// different matter, and the engine Bryntime ships is patched so that one stays
// valid.
const namespaceFor = (filename, named = null) =>
    named === null ? filename.replace(/\./g, '_') : named.replace(/-/g, '_');

// The namespace the code Brython generated for `source` opens, which the
// runtime intercepts, by the name Python imports the module by (`named`).
//
// Brython derives the namespace identifier from the filename, or from the name
// `$B.url2name` gives it: `module` and `locals_id` are ignored by
// js_from_root, so the name to hook is not the module's. Upstream maps only
// '.' to '_', so a real path emitted `locals_src/Counter_svelte`, which is not
// valid JavaScript; the engine Bryntime ships is patched to neutralise every
// character that cannot appear in an identifier. That is what lets the real
// path be passed, so Python's __file__ names the actual file, which is what a
// traceback shows.
function moduleNamespace(host, js, source, named = null) {
    const namespace = namespaceFor(source, named);

    if (!js.includes(namespaceCall(namespace))) {
        throw new Error(
            `${host.name}: the code generated for ${source} never calls ${namespaceCall(namespace)}. ` +
                `Brython's codegen no longer exposes the module namespace where Bryc hooks it`
        );
    }

    return namespace;
}

// The names of the host's runtime a generated module imports, each under the
// name the host gives it (`host.runtime`).
const runtimeAliases = (host, names) =>
    names.map((name) => (host.runtime[name] === name ? name : `${name} as ${host.runtime[name]}`)).join(', ');

// The ES module that holds the code Brython generated, apart from anything the
// host writes: `init(namespace)` runs the Python body inside the namespace it
// is handed, and a Python exception it raises comes out as the runtime makes
// it, said for `source`. A framework that parses the script it is handed, and
// reserves a prefix Brython's code opens with (`var $B`), never parses this.
function moduleCode(host, { js, namespace, source }) {
    return [
        `import { ${runtimeAliases(host, ['withNamespace', 'pyError'])} } from '${host.bridge}';`,
        ``,
        `export function init(${NS}) {`,
        `  try {`,
        `    return ${host.runtime.withNamespace}(${JSON.stringify(namespace)}, ${NS}, () => {`,
        js,
        `    });`,
        `  } catch (err) { throw ${host.runtime.pyError}(err,${JSON.stringify(source)}); }`,
        `}`
    ].join('\n');
}

// What the namespace inherits its names from: one accessor per name, which
// reads and writes the cell that holds it, so the namespace is a view of them.
const PROTO = '__proto';

// The namespace the Python body runs in, made of the accessors (`PROTO`), and
// known to Python by `name`. Replaced by a new one when a module's body raises
// (`replaced`).
function namespaceObject(host, { name, replaced = false }) {
    return [
        `${replaced ? 'let' : 'const'} ${NS} = ${host.runtime.jsGlobal}.Object.create(${PROTO});`,
        // Reading a global goes through $B.resolve_global → resolve_in_namespace,
        // which demands an *own* property unless the namespace is flagged
        // $proxy, in which case it reads the property normally and therefore
        // walks the prototype chain, where our accessors live. It is the only
        // place in Brython that consults this flag.
        `${NS}.$proxy = true;`,
        // Every namespace Brython makes for itself carries the module's own
        // name, and `from x import y` reads it off the *importing* module to
        // work out what package it sits in, so ours carries one too.
        `${NS}.__name__ = ${JSON.stringify(name)};`
    ];
}

// Brython scatters `$B.set_lineno(frame, N)` through the code it generates, so
// the generated JS carries the Python line it came from. That is enough for a
// line-level source map: the debugger then shows the .py or .svelte file rather
// than a thousand lines of generated JavaScript.
const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(value) {
    let rest = value < 0 ? (-value << 1) | 1 : value << 1;
    let encoded = '';

    do {
        let digit = rest & 31;
        rest >>>= 5;
        if (rest > 0) digit |= 32;
        encoded += VLQ_CHARS[digit];
    } while (rest > 0);

    return encoded;
}

function sourceMap(generated, source, content, lineOffset) {
    const marker = /\$B\.set_lineno\(frame, (\d+)\)/;
    const segments = [];
    let previous = 0;
    let current = null;

    for (const line of generated.split('\n')) {
        const found = line.match(marker);
        if (found) current = Number(found[1]) - 1 + lineOffset;

        if (current === null) {
            segments.push('');
            continue;
        }

        // One segment per line: column 0 of the generated line maps to column 0
        // of the Python line. Everything in a source map is delta-encoded.
        segments.push(vlq(0) + vlq(0) + vlq(current - previous) + vlq(0));
        previous = current;
    }

    return {
        version: 3,
        sources: [source],
        sourcesContent: [content],
        names: [],
        mappings: segments.join(';')
    };
}

// The setter's parameter, in every accessor.
//
// A module-level name gets a binding, and the setter assigns to it, so a bare
// parameter would shadow the cell for its own spelling, and `v` is what anyone
// writes after a decade of `for k, v in d.items()`. So it carries the prefix
// the rest of the generated code carries.
//
// `JS_RESERVED` cannot catch such a name, a perfectly good JavaScript binding,
// and the host's own words cannot either. A name the generated code uses for
// itself is a third category, and the answer to that category is a prefix
// rather than a list.
const NEXT_VALUE = '__next';

// What a change in place of the name's container calls, which moves every
// reader of the name: `track` keeps on it what the name holds.
const bump = (name) => `__bump_${name}`;

// The cell that holds `name`, under the variable `cell`, as the host makes a
// state: what it declares, with the `bump` that moves the state's readers.
const stateCell = (host, name, cell) => host.state.cell(name, cell, bump(name));

// The accessor of `name`, whose cell is `cell`.
//
// Reading what moves on a change in place alongside the value is what
// registers the dependency (`host.state.read`): an in-place mutation then
// invalidates every reader, without the value ever changing identity. Except
// for the rows of a template's loop (`SHAPING`), which follow the value's own
// changes and what they read under it, off the cell itself
// (`host.state.value`).
//
// A write that changes nothing leaves the cell as it was (`changesNothing`), as
// a framework's state is left by a value `===` to the one it holds: a float
// written again as a new object of the same number is one a framework takes
// for a change. The cell keeps the float it held, which nothing tells apart
// from the one written: the engine's `is` and `id()` take two floats of one
// number for one. Compared with what the name held as `track` keeps it, on its
// `bump`, and not with the cell, which an effect writing the name would
// subscribe to. `subs` is the list an instance signs its containers onto, or
// null for a module, which keeps them as long as the page; `held` the getter of
// what the name holds as itself, for a function a decorator may have wrapped.
function stateBinding(host, name, cell, { subs = null, held = null } = {}) {
    const { bind, SHAPING, followOwn, track, changesNothing } = host.runtime;
    const write =
        `const __was = ${bump(name)}.held;` +
        ` const __written = ${track}(${NEXT_VALUE}, ${bump(name)}${subs === null ? '' : `, ${subs}`});` +
        ` if (!${changesNothing}(__written, __was)) ${host.state.write(cell, '__written')};`;

    return (
        `${bind}(${PROTO}, '${name}', () => (${SHAPING}.on ? ${followOwn}(${host.state.value(cell)}) : ${host.state.read(name, cell)}), ` +
        `(${NEXT_VALUE}) => { ${write} }${held === null ? '' : `, () => ${held}`});`
    );
}

// What a name of the generated module may be. JavaScript binds every name the
// module declares, so a name it reserves cannot be one, and neither can one of
// the compiler's own shape. Asked of every name that becomes a binding there,
// the author's and an import's alike.
//
// Python identifiers that JavaScript will not accept as bindings.
//
// Half of them are Python keywords too and can never be written; the rest are
// ordinary Python names an author reaches for without a thought: `default`,
// `new`, `enum`, `interface`, `package`, `static`, `case`. At module level they
// are refused, with why and what to rename to. They stay perfectly usable
// *inside* a `def`, where the generated module binds nothing.
//
// And `undefined`, which JavaScript accepts as a binding and keeps for its own
// value: the generated code writes it everywhere, and a module binding it
// stopped loading. The other globals it reaches, `Object`, `Symbol`, `Error`
// and the global object, it reaches through the runtime.
const JS_RESERVED = new Set(`break case catch class const continue debugger default delete do else
enum export extends false function if implements in instanceof interface let new null package
private protected public return static super switch this throw true typeof var void while with
yield arguments eval undefined`.split(/\s+/));

// The compiler's own prefix, and the one rule that keeps it.
//
// The compiler builds names out of the author's, `__fn_go` out of `go`, and
// declares them in the same scope as the author's names: an author's name of
// that shape collides with the construct that emits it, `Identifier '__fn_go'
// has already been declared`, inside the emitted script.
//
// A prefix rather than a list, because a list cannot cover the family added
// next. And a *trailing* `__` is what makes it safe: every name Python itself
// puts in a module carries one, `__all__`, `__doc__`, `__js__`, so the rule
// refuses the compiler's shape and leaves Python's alone.
const COMPILER_PREFIX = /^__(?!.*__$)/;

// What an `importjs` clause may contain, and ASCII is a defensible line there
// even though JavaScript takes `let élève = 1`: the name is one the author
// copies out of a JavaScript package.
const JS_NAME = /^[A-Za-z_$][\w$]*$/;

// What a `.py` exports, whether through `__all__` or by default, has Python's
// answer, so `__all__ = ["élèves"]` exports `élèves`, where the name of an
// `importjs` clause is ASCII (`JS_NAME`). Same class as a template
// expression's `NAME`, and for the same reason.
//
// Python's own classes, `XID_Start` and `XID_Continue`, which `str.isidentifier`
// answers by: `℘`, `℮` and `ᢅ` start a name and `·` continues one.
const PY_NAME = /^[\p{XID_Start}_]\p{XID_Continue}*$/u;

// Why the local name of a JavaScript import cannot be bound, or null. It is a
// binding of the generated module, so it answers to the two rules every name
// there does: `new` and `default` stopped the module parsing, `__py` declared a
// name the compiler had declared already, and both were said by the JavaScript
// parser downstream rather than at the line that wrote them.
function unbindable(name) {
    if (!JS_NAME.test(name)) return 'which is not a name';
    if (JS_RESERVED.has(name)) return 'which JavaScript reserves, so the generated module cannot bind it';
    if (COMPILER_PREFIX.test(name)) return "which starts with `__`, the compiler's own prefix";

    return null;
}

// A name as Python reads it, by the engine's own rule: NFKC past ASCII, as its
// parser reads every identifier.
function pythonKey(name) {
    return engine()._PyPegen.new_identifier(null, name);
}

// A word the host reserves (`host.reserved.words`) is its own, not a builtin to
// shadow: refused rather than quietly given to either side. Scoped like the
// host's injection of it, so a component's word (`component`) is free in a
// plain `.py`. `lines` says where each name was bound, so the refusal names
// the line the word was taken on; a name with none is said with the file
// alone. What the host provides that may still be shadowed is the host's to
// say (`host.reserved.said`).
function refuseHostWords(host, declared, component, source, lines, lineOffset = 0) {
    const taken = host.reserved.words.find((one) => (component || !one.component) && declared.includes(one.name));

    if (!taken) return;

    const line = lines?.get(taken.name);
    const at = line === undefined ? source : `${source}:${line + lineOffset}`;

    throw refuse(
        `${host.name} — \`${taken.name}\` is one of ${host.name[0].toUpperCase()}${host.name.slice(1)}'s own words and cannot be ` +
            `redefined (${at}). ${host.reserved.said}`,
        source,
        line === undefined ? undefined : line + lineOffset
    );
}

// A module-level name JavaScript will not take as a binding (`JS_RESERVED`),
// the first of `reserved`, refused on the line `lines` says it was bound on.
//
// Kept, it would fail three ways: a component would render its **first** value
// and never follow it, a module's `def default()` would not be exported, and a
// value named in `__all__` would be told *this module never binds it*, which is
// false: the module binds it, JavaScript reserves it.
//
// So it is refused: winning in silence is the worst of the three behaviours.
// The cost is one underscore, and Python has a convention for exactly this
// collision.
//
// After `refuseHostWords`, which is given these names too: `export` is both one
// of a host's words and a JavaScript keyword, and *that* is what a reader needs
// to be told first.
function refuseReserved(host, reserved, source, lines, lineOffset = 0) {
    const [name] = reserved;

    if (name === undefined) return;

    const line = lines?.get(name);
    const at = line === undefined ? source : `${source}:${line + lineOffset}`;
    const why =
        name === 'undefined'
            ? `is JavaScript's own value, which the generated module writes itself, so it cannot bind the name`
            : `is a reserved word in JavaScript, and the generated module cannot bind one`;

    throw refuse(
        `${host.name} — \`${name}\` ${why} (${at}). It is good Python and nothing else is ` +
            `wrong with it, but nothing reactive can be built on the name: the page ` +
            `would show its first value and never follow it, and a module cannot ` +
            `publish it. Rename it: Python's own convention for a name that collides ` +
            `with a keyword is a trailing underscore, \`${name}_\`.`,
        source,
        line === undefined ? undefined : line + lineOffset
    );
}

export {
    counterStart,
    compilePython,
    translation,
    NS,
    moduleNamespace,
    runtimeAliases,
    moduleCode,
    PROTO,
    namespaceObject,
    sourceMap,
    NEXT_VALUE,
    bump,
    stateCell,
    stateBinding,
    JS_RESERVED,
    COMPILER_PREFIX,
    JS_NAME,
    PY_NAME,
    unbindable,
    pythonKey,
    refuseHostWords,
    refuseReserved
};
