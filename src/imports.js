// What a source imports, and what the page does not have. The JavaScript a
// Python source imports: `__js__` in a plain module, read off the AST, and
// `importjs` in a component, a line of its own. The modules it imports, and
// the imports the runtime cannot satisfy. The calls that need what the page
// does not have. Each refused, under the host's name (`host.name`), on its
// line.
import { atomic, pythonName } from './expressions.js';
import { refuse } from './errors.js';
import { BODIES, walkScoped, builtinIn, scopeIn, isGlobalScope, blockBinds, moduleBinds } from './scopes.js';
import { JS_NAME, unbindable, PROTO } from './translation.js';

// `__js__` keeps a literal reading, where `__all__` is run as Python runs it
// (`declaredExports`): it is a directive, set by one assignment and changed by
// nothing else. **Unreadable** is an element its source does not spell.
const UNREADABLE = Symbol('unreadable');

const NAMES = (node) => {
    const ast = globalThis.__BRYTHON__.ast;

    return node instanceof ast.List || node instanceof ast.Tuple
        ? node.elts.map((one) => (one instanceof ast.Constant ? one.value : UNREADABLE))
        : null;
};

const readable = (given) => given !== null && !given.includes(UNREADABLE);
const strings = (given) => given.filter((one) => typeof one === 'string');

// `__js__ = {"@sveltejs/kit": ["error", "redirect"]}`: the JavaScript a module
// needs. Python has no way to import from npm, and a plain `.py` has no
// `<script module>` to do it for them; this is its equivalent, written as an
// ordinary assignment and read from the AST like `__all__`, under the same two
// rules: the value that counts is the last one assigned, and what a static read
// cannot follow is refused rather than skipped.
function declaredJsImports(host, ast, table, source, lineOffset = 0) {
    const $B = globalThis.__BRYTHON__;
    const body = ast.body;
    let modules = [];

    const refuseAt = (node, what) => {
        const line = node.lineno + lineOffset;

        throw refuse(`${host.name} — \`__js__\` ${what} (${source}:${line})`, source, line);
    };

    // Any other write reaches the dict after the read: `__js__["m"] = […]`,
    // `__js__ |= {…}`, `__js__.update(…)`, wherever the name is the module's.
    // A parameter or a local of that name is the function's own, as with
    // `__all__`.
    const isJs = (node) => node instanceof $B.ast.Name && node.id === '__js__';
    walkScoped(body, (node, scope) => {
        const changed =
            ((node instanceof $B.ast.AugAssign || node instanceof $B.ast.AnnAssign) && isJs(node.target)) ||
            (node instanceof $B.ast.Subscript && isJs(node.value) && !(node.ctx instanceof $B.ast.Load)) ||
            (node instanceof $B.ast.Call && node.func instanceof $B.ast.Attribute && isJs(node.func.value));

        if (!changed) return;

        const block = scope === null ? null : table.blockOf(scope);
        if (block !== null && block !== undefined && !isGlobalScope(scopeIn(block, '__js__'))) return;

        refuseAt(node, 'is set by assigning it, and changed by nothing else');
    });

    for (const node of body) {
        if (!(node instanceof $B.ast.Assign)) continue;
        if (!node.targets.some((t) => t instanceof $B.ast.Name && t.id === '__js__')) continue;

        if (!(node.value instanceof $B.ast.Dict)) {
            refuseAt(node, 'has to be written out as a dict of module names to lists of names');
        }

        modules = node.value.keys.map((key, index) => {
            const names = NAMES(node.value.values[index]);

            if (!(key instanceof $B.ast.Constant) || typeof key.value !== 'string' || !readable(names)) {
                refuseAt(node, 'has to be written out: each key a module name, each value a list of strings');
            }

            // The same question `importjs` asks, with the same answer.
            for (const one of strings(names)) {
                const why = unbindable(one);

                if (why !== null) refuseAt(node, `names \`${one}\`, ${why}`);
            }

            return { from: key.value, names: strings(names) };
        });
    }

    return modules.filter((one) => one.names.length);
}

// `importjs`: a component's JavaScript imports, written where its Python is.
//
// `__js__` covers a plain `.py`, and only the named form, which is all a module
// ever asks for: `error`, `redirect`, `query`, `browser`. A component asks for
// three more, and every one of them is a template concern: the default export,
// which is how a `.svelte` child is imported and by far the commonest (25 of
// 65 imports across three projects); a stylesheet, imported for its
// effect; and a namespace, which is what `<Dialog.Root>` needs. None of the three
// can occur in a module with no markup, which is why the dialect stops at the
// component and a `.py` keeps parsing as Python.
//
// A keyword rather than another declaration read from the AST. `__all__` is real
// Python and the compiler only reads it; `__js__` wears the same costume without
// the language behind it, and a dict literal invites being computed, which
// parses, raises nothing, and does not work. A keyword makes that unwriteable
// instead of merely wrong, the same way the walrus works in the markup: the
// syntax says what the thing is.
//
// The clause is JavaScript's own, since the keyword has already announced that
// much. There is nothing new to learn, and no ambiguity to invent between a
// default import and a named one.
const IMPORTJS = /^importjs\b/;
const IMPORTJS_ANYWHERE = /^[ \t]+importjs\b/;
// The module's string as JavaScript writes one: anything but its own quote, so
// `"./O'Brien.svelte"` is a path. An escape is not read, and is refused. A
// Python comment may follow it, as it may follow any line; a `#` inside the
// string is the path's.
const IMPORTJS_CLAUSE = /^importjs\s+([\s\S]*?)\s+from\s+(?:"([^"\\\n]+)"|'([^'\\\n]+)')\s*(?:#.*)?$/;
const IMPORTJS_EFFECT = /^importjs\s+(?:"([^"\\\n]+)"|'([^'\\\n]+)')\s*(?:#.*)?$/;

// For each line of `src`, whether it begins inside a string an earlier line
// opened. Only a triple-quoted string survives a line break, so it is the only
// thing that can hide an `importjs` or a sign further down, the trap a regex
// over the whole source would walk straight into. Read over the whole source at
// once, by `atomic`: an f-string's fields may hold quotes of their own, and no
// line can then be read alone.
function continuedLines(src) {
    const inside = [false];

    for (let i = 0; i < src.length; i++) {
        const skip = atomic(src, i);

        if (skip > 0) {
            for (let j = i; j < i + skip; j++) if (src[j] === '\n') inside.push(true);
            i += skip - 1;
        } else if (src[i] === '\n') inside.push(false);
    }

    return inside;
}

// `where` is the sentence's `file:line`; `source` and `lineno` are the same two
// facts as fields, which is what an editor reads.
function importJsClause(host, line, where, source, lineno) {
    const bare = line.match(IMPORTJS_EFFECT);
    if (bare) return { from: bare[1] ?? bare[2], kind: 'effect', entries: [] };

    const found = line.match(IMPORTJS_CLAUSE);
    if (!found) {
        throw refuse(
            `${host.name} — importjs expects \`importjs <clause> from "module"\` or ` +
                `\`importjs "module"\`, on one line (${where})`,
            source,
            lineno
        );
    }

    const clause = found[1].trim();
    const from = found[2] ?? found[3];

    // Every name the clause binds, whatever its shape: `__js__` asks the same.
    // The name it imports may be any word, `{default as player}`; the one it
    // binds may not.
    const bound = (declared) => {
        for (const { local } of declared.entries) {
            const why = unbindable(local);

            if (why !== null) throw refuse(`${host.name} — importjs: \`${local}\` ${why} (${where})`, source, lineno);
        }

        return declared;
    };

    const star = clause.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (star) return bound({ from, kind: 'namespace', entries: [{ name: null, local: star[1] }] });

    // `{a, b as c}`: the names between the braces, each optionally renamed.
    const namedEntries = (inner) => {
        const entries = inner
            .split(',')
            .map((one) => one.trim())
            .filter(Boolean)
            .map((one) => {
                const renamed = one.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
                if (renamed) return { name: renamed[1], local: renamed[2] };
                if (JS_NAME.test(one)) return { name: one, local: one };

                throw refuse(
                    `${host.name} — importjs: \`${one}\` is not a name (${where})`,
                    source,
                    lineno
                );
            });

        if (!entries.length) {
            throw refuse(`${host.name} — importjs: empty {} (${where})`, source, lineno);
        }
        return entries;
    };

    const braced = clause.match(/^\{([\s\S]*)\}$/);
    if (braced) return bound({ from, kind: 'named', entries: namedEntries(braced[1]) });

    // `Player, {stopAll}`: the default and some names, from the same module.
    // JavaScript's own clause allows it, and a component that imports both a
    // component and something from its `<script module>` needs exactly this.
    // The default comes first in `entries`, marked by a null `name`.
    const mixed = clause.match(/^([A-Za-z_$][\w$]*)\s*,\s*\{([\s\S]*)\}$/);
    if (mixed) {
        return bound({
            from,
            kind: 'mixed',
            entries: [{ name: null, local: mixed[1] }, ...namedEntries(mixed[2])]
        });
    }

    if (JS_NAME.test(clause)) return bound({ from, kind: 'default', entries: [{ name: null, local: clause }] });

    throw refuse(
        `${host.name} — importjs: \`${clause}\` is not an import clause (${where})`,
        source,
        lineno
    );
}

// Lift every `importjs` out of the source, leaving the line blank behind it.
//
// Blank rather than removed, and on the same line rather than rewritten into a
// call: the source map is line-level, `sourceMap()` emits column zero on both
// sides, so a line-preserving pass costs the debugger, the tracebacks and
// `$B.set_lineno` exactly nothing.
function takeImportJs(host, src, where, lineOffset, allowed) {
    const lines = src.split('\n');
    const continued = continuedLines(src);
    const imports = [];
    const kept = [];

    for (let n = 0; n < lines.length; n++) {
        const line = lines[n];
        const lineno = n + 1 + lineOffset;
        const at = `${where}:${lineno}`;

        if (!continued[n] && IMPORTJS_ANYWHERE.test(line)) {
            // A JavaScript import is hoisted and static; there is no such thing
            // as one inside a branch, and silently hoisting it would be a lie.
            throw refuse(
                `${host.name} — importjs must start the line, at the top level (${at})`,
                where,
                lineno
            );
        }

        if (!continued[n] && IMPORTJS.test(line)) {
            if (!allowed) {
                throw refuse(
                    `${host.name} — importjs belongs to a component; a .py module declares its ` +
                        `JavaScript with __js__ = {"module": ["name"]} (${at})`,
                    where,
                    lineno
                );
            }

            imports.push(importJsClause(host, line.trim(), at, where, lineno));
            kept.push('');
            continue;
        }

        kept.push(line);
    }

    return { source: kept.join('\n'), imports };
}

// The variable a JavaScript import is held under. Its own name, unless the
// framework's compiler reads that name as its own once a binding takes it
// (`host.runes`): Svelte reads `$effect` as a store as soon as the module binds
// `effect`, which turns every `$effect` it writes into a read of the import.
// Python still reads the import under its own name (`jsNameBindings`).
const jsLocal = (host, name) => ((host.runes ?? []).includes(name) ? `__import_${name}` : name);

// One import statement, in whichever of the five shapes it was declared.
function jsImportLine(host, one) {
    const from = JSON.stringify(one.from);
    const local = (e) => jsLocal(host, e.local);
    const list = (entries) => entries.map((e) => (e.name === local(e) ? e.name : `${e.name} as ${local(e)}`)).join(', ');

    if (one.kind === 'effect') return `import ${from};`;
    if (one.kind === 'namespace') return `import * as ${local(one.entries[0])} from ${from};`;
    if (one.kind === 'default') return `import ${local(one.entries[0])} from ${from};`;

    if (one.kind === 'mixed') {
        const [first, ...rest] = one.entries;
        return `import ${local(first)}, { ${list(rest)} } from ${from};`;
    }

    return `import { ${list(one.entries)} } from ${from};`;
}

// The JavaScript a source imports, both declarations met in one shape:
// `__js__` is the module's and only ever names, `importjs` is the component's
// (`lifted`, what `takeImportJs` took out of it) and covers the four forms.
const jsImportsOf = (host, ast, table, source, lineOffset, lifted) => [
    ...declaredJsImports(host, ast, table, source, lineOffset).map((one) => ({
        from: one.from,
        kind: 'named',
        entries: one.names.map((n) => ({ name: n, local: n }))
    })),
    ...lifted
];

// The JavaScript names a module reaches for, wrapped and published on the
// accessors of its namespace (`PROTO`), through the host's runtime.
//
// Wrapped once and not on every read: a name Python compares by identity,
// `handler is on_click`, has to answer the same object twice. And a name Python
// declares itself (`declared`) wins over a name the host's JavaScript gives,
// which is what the filter is for; a name `__js__` or `importjs` brings
// (`jsImported`), Python never binds.
//
// `extra` is what a host's component has and a plain `.py` cannot: the names
// JavaScript beside it imported, a `<script module>`'s. They are wrapped like
// the rest and bound like the rest, so the only difference between the two
// paths is that list, which is why this is one function rather than the same
// six lines twice.
function jsNameBindings(host, { jsImported, declared, source }, extra = []) {
    const { bind, jsCall, readOnlyImport } = host.runtime;

    // Once each. The two lists overlap whenever a component names the same
    // import in its `<script module>` and in an `importjs`, and the two loops
    // this replaces then bound it twice: the same line, emitted after itself.
    const names = [...new Set([...jsImported, ...extra])].filter((n) => !declared.includes(pythonName(n)));

    // Published under the name Python reads (`pythonName`), each read off the
    // variable as JavaScript spells it: `ﬁeld` in the `<script module>` is
    // `field` to Python, which raised `NameError` on both spellings. Two
    // variables Python reads as one name are refused, which one wins being
    // nobody's choice.
    const published = new Map();

    for (const n of names) {
        const other = published.get(pythonName(n));

        if (other !== undefined) {
            throw new SyntaxError(
                `${host.name} — \`${other}\` and \`${n}\` are two JavaScript names Python reads as one, ` +
                    `\`${pythonName(n)}\` (${source}): Python normalizes a name as Unicode's NFKC does, ` +
                    `so the template could reach only one of them. Give one of them another name.`
            );
        }
        published.set(pythonName(n), n);
    }

    // **Read at every access, because a name is a binding and not a value.**
    // `let amount = 1` in a `<script module>` reaches Python as what the
    // JavaScript holds now, wherever Python asks, a reactive read or a function
    // asking again.
    //
    // Safe to read afresh because the runtime adapts a function once (`jsCall`):
    // the same function gives the same proxy, so a callback registered from
    // Python can still be taken back.
    //
    // A name `__js__` or `importjs` brings is JavaScript's import, which only
    // its module writes, and which a `.py` re-exports as JavaScript's own
    // binding: an import is read-only in JavaScript, and a write from Python,
    // through `globals()` or from another module, is refused as JavaScript
    // refuses it, rather than taken by Python's reader and missed by
    // JavaScript's.
    // An import is read off the variable it is held under (`jsLocal`).
    return names.map((n) =>
        jsImported.includes(n)
            ? `${bind}(${PROTO}, '${pythonName(n)}', () => ${jsCall}(${jsLocal(host, n)}), () => ${readOnlyImport}(${JSON.stringify(n)}, ${JSON.stringify(source)}));`
            : `${bind}(${PROTO}, '${pythonName(n)}', () => ${jsCall}(${n}));`
    );
}

// The names a node binds where it stands: a name stored or deleted, a `def`, a
// `class`, an import alias, an `except … as` and a `match` capture. What the
// symbol table counts as a binding, read back off the tree to say where.
const bindsHere = (node) => {
    const ast = globalThis.__BRYTHON__.ast;

    if (node instanceof ast.Name) return node.ctx instanceof ast.Load ? [] : [node.id];
    if (node instanceof ast.alias) return node.name === '*' ? [] : [node.asname ?? node.name.split('.')[0]];
    if (node instanceof ast.MatchMapping) return node.rest ? [node.rest] : [];

    const named = ['FunctionDef', 'AsyncFunctionDef', 'ClassDef', 'ExceptHandler', 'MatchAs', 'MatchStar'];

    return named.some((one) => node instanceof ast[one]) && node.name ? [node.name] : [];
};

// A name `__js__` or `importjs` brings is JavaScript's import, which Python
// reads live and never binds, as JavaScript never assigns one: an engine
// refuses a module that declares an import and a `let` of the same name. So
// a binding of one is refused here, with its line, as a write at run time is
// (`readOnlyImport`).
//
// A node binds the module's name where it stands in the module, or in a scope
// that declares the name `global`, which Python's symbol table answers for the
// scope. Asked node by node and not of the module's block, where Python also
// files the variable of a comprehension it inlines, which binds nothing of the
// module's.
function refuseBoundImports(host, ast, table, imported, source, lineOffset) {
    const $B = globalThis.__BRYTHON__;
    const names = new Set(imported);

    walkScoped(ast.body, (node, scope, line) => {
        const block = scope === null ? null : table.blockOf(scope);
        const module = (name) =>
            scope === null || (block !== undefined && scopeIn(block, name) === $B.SYMBOL_FLAGS.GLOBAL_EXPLICIT);
        const name = bindsHere(node).find((one) => names.has(one) && module(one));

        if (name === undefined) return;

        throw refuse(
            `${host.name} — \`${name}\` is a JavaScript import, which Python reads and never binds, as ` +
                `JavaScript never assigns one (${source}:${line + lineOffset}). Bind another name to hold ` +
                `a value of your own.`,
            source,
            line + lineOffset
        );
    });
}

// The modules a source imports, and the imports the runtime cannot satisfy,
// refused on their line: a relative one, one of a module that does not ship,
// and the syntax that imports `typing` behind the author's back.

// The modules the source imports, `import x` and `from x import y` alike.
//
// Brython's own bookkeeping, `root.imports`, records `import x` and nothing
// else, so the walk reads `from x import y` too: the prelude that resolves a
// sibling `.py` needs both.
//
// Walked rather than read off the top level, because an import inside a function
// or a `try` is still an import.
//
// Asked of the AST alone: a regular expression over the text would read an
// import in a triple-quoted string, where usage examples live, and load a
// module for a name that appears only in documentation. The walk recognises a
// node by shape, since a bundled build carries a second set of AST classes.
//
// `import x` is read by the same walk, so every module the source names comes
// with the line that names it first: what a refusal of that import points at.
//
// A relative import, `from . import x` or `from .x import y`, is kept apart: it
// names no module, only a place in a package, and a component is in none.
function moduleImports(ast) {
    const $B = globalThis.__BRYTHON__;
    const found = new Map();
    const relative = [];
    const add = (module, node) => {
        if (!found.has(module)) found.set(module, node.lineno);
    };

    const walk = (node) => {
        if (!node || typeof node !== 'object') return;

        if (Array.isArray(node)) {
            node.forEach(walk);
            return;
        }

        // Recognised by shape, not by class. Brython builds its AST classes with
        // `eval`, and a bundled build ends up with a second set: `instanceof`
        // then answers false for a node that is plainly an ImportFrom, and a
        // sibling module would not be resolved for a component compiled in a
        // browser. An ImportFrom is the only node carrying a
        // module name, an alias list and a level together, and a relative
        // import (`from . import x`) names no module.
        const importFrom =
            typeof node.module === 'string' && Array.isArray(node.names) && typeof node.level === 'number';

        // An Import carries aliases and no level; a `global` carries names that
        // are plain strings.
        const importNode =
            Array.isArray(node.names) && typeof node.level !== 'number' && typeof node.names[0]?.name === 'string';

        const dotted = Array.isArray(node.names) && node.level > 0;

        // `from browser import timer` imports the submodule `browser.timer`
        // when Brython's catalogue names one, rather than an attribute.
        if (dotted) relative.push(node);
        else if (importFrom) {
            add(node.module, node);
            for (const one of node.names) {
                const submodule = `${node.module}.${one.name}`;
                if ($B.stdlib[submodule]) add(submodule, node);
            }
        }
        if (importNode) for (const one of node.names) add(one.name, node);

        for (const key of BODIES) if (node[key]) walk(node[key]);
    };

    walk(ast.body);
    return { found, relative };
}

// A relative import has no package to be relative to, and fails at mount with
// `ImportError`. A neighbouring module is named by its own name, which is what
// the refusal writes out.
function refuseRelativeImports(host, relative, source, lineOffset) {
    const [node] = relative;
    if (!node) return;

    const aliases = node.names.map((one) => (one.asname ? `${one.name} as ${one.asname}` : one.name)).join(', ');
    const absolute = node.module ? `from ${node.module} import ${aliases}` : `import ${aliases}`;
    const line = node.lineno + lineOffset;

    throw refuse(
        `${host.name} — a relative import has no package to be relative to: a module ` +
            `beside the component, or on \`${host.pathOption}\`, is imported by its own name, ` +
            `\`${absolute}\` (${source}:${line})`,
        source,
        line
    );
}

// The modules the runtime holds, the ones the engine Bryvend ships registers
// as it loads. Python's standard library does not ship: anything else an `import`
// names is one of the project's own files or nothing, and Brython, looking for
// nothing, raises `JavascriptError` rather than `ImportError`. Held to the
// runtime's by a component that imports each of them.
const PROVIDED_MODULES = new Set([
    'browser',
    'browser.aio',
    'browser.html',
    'javascript',
    'builtins',
    '_sys',
    '_warnings',
    '_importlib',
    '_suggestions'
]);

// An `import` of a module that is neither the runtime's nor a file of the
// project, refused on its line: in the browser it would fail at mount.
// `resolves` answers `'file'`, `'package'` when the name's first segment is a
// directory of the project, or nothing. What stands in for the module is the
// host's to say (`host.instead`), since it names what the host provides.
function refuseMissingModules(host, importedAt, resolves, source, lineOffset) {
    for (const [module, line] of importedAt) {
        const found = PROVIDED_MODULES.has(module) ? 'file' : resolves(module);
        if (found === 'file') continue;

        const [first] = module.split('.');
        const instead = host.instead[module];

        // A module resolves by its file name alone, beside the component or on
        // the host's search path (`host.pathOption`): a directory is not a
        // package.
        const reason =
            found === 'package'
                ? `\`${first}\` is a directory, and a module is found by its file ` +
                  `name alone, beside the component or on \`${host.pathOption}\`, not through a ` +
                  `package; put the module beside the component, or add \`${first}\` ` +
                  `to \`${host.pathOption}\` and import the module by its own name`
                : `Python's standard library does not ship, only \`browser\`, ` +
                  `\`javascript\` and the project's own \`.py\` files do` +
                  (instead ? `; ${instead}` : '');

        throw refuse(
            `${host.name} — \`${module}\` is not a module a component can import: ` +
                `${reason} (${source}:${line + lineOffset})`,
            source,
            line + lineOffset
        );
    }
}

// The syntax of PEP 695, `type Pair = tuple[int, int]` and the parameters of
// `def first[T]` or `class Box[T]`, builds its objects with `typing`, which
// Brython imports as `_typing` from the standard library: it compiled, and the
// component died at mount on `Network error`. Refused on its line, as an import
// of a module that does not ship is. Recognised by shape, for the reason
// `moduleImports` gives: an alias holds its parameters and no body.
function refuseTypeParameters(host, body, source, lineOffset) {
    const walk = (statements) => {
        for (const node of statements) {
            const alias = Array.isArray(node.type_params) && node.body === undefined;

            if (alias || node.type_params?.length > 0) {
                const line = node.lineno + lineOffset;
                const written = alias
                    ? `type ${node.name.id} = …`
                    : `${node.bases ? 'class' : 'def'} ${node.name}[${node.type_params.map((one) => one.name).join(', ')}]`;

                throw refuse(
                    `${host.name} — \`${written}\` builds its objects with \`typing\`, part ` +
                        `of Python's standard library, which does not ship; ` +
                        (alias
                            ? `an alias is an ordinary assignment, \`${node.name.id} = …\``
                            : `an annotation names the type itself, without the parameters`) +
                        ` (${source}:${line})`,
                    source,
                    line
                );
            }

            for (const key of BODIES) if (node[key]) walk(node[key]);
        }
    };

    walk(body);
}

// What a source calls that needs what the page does not have: a builtin that
// parses or loads at run time or opens a file, and a method or a `help()` that
// Brython answers with a module of the standard library, which does not ship.
// Refused on its line.

// What Brython's runtime imports on its own from the standard library: `copyreg`
// for `__reduce__` and `__reduce_ex__`, and `pydoc` for `help("name")` when the
// name is neither a standard module nor a builtin, which Brython answers with a
// link to the documentation. Each compiled and died at run time on `Network
// error`; refused on its line, as an import of the module would be. `help` is
// the builtin only while the author binds no name of that spelling.
const IMPORTED_BY_METHOD = { __reduce__: 'copyreg', __reduce_ex__: 'copyreg' };

// Builtins that need what the page does not have, each refused while the name
// is the builtin: in the browser they would raise `$B.Parser is not a
// constructor` or `Network error`.
const PARSED = 'parses its text at run time, and the runtime the page loads has no parser';
const UNSHIPPED_BUILTINS = {
    eval: PARSED,
    exec: PARSED,
    compile: PARSED,
    __import__: 'loads a module at run time, past the compiler that checks and bundles imports; write `import name`',
    open: 'reads a file, and a page has no file system to read it from'
};

// Whether a name means the builtin is Python's question, answered by the symbol
// table scope by scope: a `from db import exec` or a parameter named `compile`
// is the author's, and a local `eval` in one function leaves `eval` the builtin
// everywhere else. Any read of one counts, not only a call: `run = eval` hands
// it on. So does reaching it through the `builtins` module.
const BUILTINS_MODULES = new Set(['builtins', '__builtins__']);

function refuseLibraryCalls(host, ast, table, source, lineOffset) {
    const $B = globalThis.__BRYTHON__;
    const builtin = builtinIn(table, moduleBinds(table));
    const unshipped = (name) => Object.hasOwn(UNSHIPPED_BUILTINS, name);

    // The names that are the builtins module, `import builtins [as b]`, by the
    // block that binds them, and the attributes a class of the file binds
    // itself, by a `def`, an `async def` or an assignment, whose call is the
    // author's and needs nothing that does not ship.
    const modules = new Map();
    const defined = new Set();
    const blockAt = (scope) => (scope === null ? table.top : table.blockOf(scope));
    const imports = [];
    walkScoped(ast.body, (node, scope) => {
        if (node instanceof $B.ast.Import) {
            for (const one of node.names) if (one.name === 'builtins') imports.push([one.asname ?? 'builtins', scope]);
        }
        if (node instanceof $B.ast.ClassDef) for (const name of blockBinds(table.blockOf(node))) defined.add(name);
    });

    // A name means the module only where the binding it reads is the import:
    // the block's own, the module's for a global, or for a free name the
    // nearest enclosing function's, a class body being no enclosing scope.
    const parents = new Map();
    const index = (block) => {
        for (const child of block.children) {
            parents.set(child, block);
            index(child);
        }
    };
    index(table.top);
    const bindingBlock = (name, block) => {
        while (block !== table.top) {
            const where = scopeIn(block, name);
            if (isGlobalScope(where)) return table.top;
            if (where !== $B.SYMBOL_FLAGS.FREE) return block;
            do block = parents.get(block);
            while (block.type === $B.SYMBOL_FLAGS.TYPE_CLASS);
        }
        return block;
    };
    // Each alias under the block it binds, the module's for one a function
    // declares `global`.
    for (const [name, scope] of imports) {
        const block = bindingBlock(name, blockAt(scope));
        if (!modules.has(block)) modules.set(block, new Set());
        modules.get(block).add(name);
    }
    // And only where the read certainly finds the import: a refusal stops a
    // program from compiling, so a binding the read may find otherwise leaves
    // it to the author. Certain when every binding of the name is an import of
    // the module. Otherwise only a read in the block that binds the name is
    // looked at, and only bindings made there: each is dated where Python
    // makes it, an assignment once its value is computed, a loop's or a
    // `with`'s target before its body, a `def` or a `class` once built, and
    // the read is certain when every one before it is the import, whichever
    // branch it is in, since the branches taken are not known. A binding made
    // from another block, through a `global` or a `nonlocal`, runs whenever
    // that block does, which a call written nowhere can make it do: a
    // constructor, `__setattr__`, a function found in `globals()`. So does a
    // binding of a kind not dated here, which the symbol table still sees.
    const rebound = new Map();
    const bound = $B.SYMBOL_FLAGS.DEF_LOCAL | $B.SYMBOL_FLAGS.DEF_PARAM;
    const visit = (block) => {
        for (const { key, value } of $B.builtins.dict.$iter_items(block.symbols)) {
            if (!(value & bound)) continue;
            const target = bindingBlock(key, block);
            if (!rebound.has(target)) rebound.set(target, new Set());
            rebound.get(target).add(key);
        }
        block.children.forEach(visit);
    };
    visit(table.top);

    const aliases = new Set(imports.map(([name]) => name));
    const events = [];
    const start = (node) => [node.lineno, node.col_offset];
    const end = (node) => [node.end_lineno, node.end_col_offset];
    const before = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
    const SEQUENCES = ['Tuple', 'List', 'Starred'];
    const bindAt = (name, scope, at, isImport) => {
        if (!aliases.has(name)) return;
        const from = blockAt(scope);
        events.push({ name, from, target: bindingBlock(name, from), at, isImport });
    };
    walkScoped(ast.body, (node, scope, line, parent, grand) => {
        if (node instanceof $B.ast.Import || node instanceof $B.ast.ImportFrom) {
            for (const one of node.names) {
                const local = one.asname ?? one.name.split('.')[0];
                bindAt(local, scope, end(node), node instanceof $B.ast.Import && one.name === 'builtins');
            }
        }
        if (node instanceof $B.ast.FunctionDef || node instanceof $B.ast.AsyncFunctionDef || node instanceof $B.ast.ClassDef) {
            bindAt(node.name, scope, end(node), false);
        }
        if (node instanceof $B.ast.ExceptHandler && node.name) bindAt(node.name, scope, start(node.body[0]), false);

        if (node instanceof $B.ast.Name && node.ctx instanceof $B.ast.Store) {
            const owner = SEQUENCES.some((one) => parent instanceof $B.ast[one]) ? grand : parent;
            const at =
                owner instanceof $B.ast.For || owner instanceof $B.ast.AsyncFor
                    ? start(owner.body[0])
                    : owner instanceof $B.ast.withitem || owner === null
                      ? end(node)
                      : end(owner);
            bindAt(node.id, scope, at, false);
        }
    });

    const isModule = (name, scope, read) => {
        if (name === '__builtins__') return builtin(name, scope);
        const block = bindingBlock(name, blockAt(scope));
        if (modules.get(block)?.has(name) !== true) return false;

        const all = events.filter((one) => one.name === name && one.target === block);
        if (rebound.get(block)?.has(name) && !all.some((one) => !one.isImport)) return false;
        if (all.every((one) => one.isImport)) return true;
        if (blockAt(scope) !== block || all.some((one) => !one.isImport && one.from !== block)) return false;

        // Before it in the block, every binding the import; none there, the
        // name is whatever another block's imports made it.
        const prior = all.filter((one) => one.from === block && before(one.at, read));
        return prior.length > 0 ? prior.every((one) => one.isImport) : all.some((one) => one.from !== block);
    };
    const refuseBuiltin = (name, line) => {
        throw refuse(
            `${host.name} — \`${name}()\` ${UNSHIPPED_BUILTINS[name]} (${source}:${line + lineOffset})`,
            source,
            line + lineOffset
        );
    };

    walkScoped(ast.body, (node, scope, line) => {
        if (node instanceof $B.ast.Name && !(node.ctx instanceof $B.ast.Store) && unshipped(node.id) && builtin(node.id, scope)) {
            refuseBuiltin(node.id, line);
        }

        if (
            node instanceof $B.ast.Attribute &&
            node.value instanceof $B.ast.Name &&
            unshipped(node.attr) &&
            isModule(node.value.id, scope, start(node))
        ) {
            refuseBuiltin(node.attr, line);
        }

        if (node instanceof $B.ast.ImportFrom && BUILTINS_MODULES.has(node.module)) {
            const taken = node.names.find((one) => unshipped(one.name));
            if (taken !== undefined) refuseBuiltin(taken.name, line);
        }

        if (!(node instanceof $B.ast.Call)) return;

        const { func } = node;
        const [first] = node.args;
        const name = first instanceof $B.ast.Constant && typeof first.value === 'string' ? first.value : null;
        const module =
            func instanceof $B.ast.Attribute && !defined.has(func.attr) ? IMPORTED_BY_METHOD[func.attr] : undefined;
        const documented =
            func instanceof $B.ast.Name &&
            func.id === 'help' &&
            builtin('help', scope) &&
            name !== null &&
            $B.stdlib[name.split('.')[0]] === undefined &&
            $B.builtins[name] === undefined;

        if (module === undefined && !documented) return;

        line += lineOffset;

        throw refuse(
            module !== undefined
                ? `${host.name} — \`${func.attr}()\` builds its answer with \`${module}\`, part of ` +
                      `Python's standard library, which does not ship (${source}:${line})`
                : `${host.name} — \`help(${JSON.stringify(name)})\` looks the name up with \`pydoc\`, part ` +
                      `of Python's standard library, which does not ship; \`help(obj)\` prints ` +
                      `the object's docstring (${source}:${line})`,
            source,
            line
        );
    });
}

export {
    declaredJsImports,
    continuedLines,
    takeImportJs,
    jsLocal,
    jsImportLine,
    jsImportsOf,
    jsNameBindings,
    refuseBoundImports,
    moduleImports,
    refuseRelativeImports,
    refuseMissingModules,
    refuseTypeParameters,
    refuseLibraryCalls
};
