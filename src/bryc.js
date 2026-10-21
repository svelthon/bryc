// Brycomp, the Brython compiler for JavaScript frameworks, run at build time.
// Brython translates Python; what a framework needs around that is held here:
// Python's lexical rule, which names a template expression reads and when, the
// translation itself, the same code on every run, the module that holds it,
// the source map, a Python error made a refusal on its line, Python's scopes,
// the export list `__all__` declares, and the imports the runtime cannot
// satisfy. What the framework adds, its own syntax and how its template reads,
// stays with it.
//
// This file is the one door: nothing outside this folder imports another file
// of it, so each stays Brycomp's to split, move or rename.
//
// Brycomp runs on Bryvend, Brython with its fixes: the engine started, then its
// parsing chain, which this door loads, in that order, before any file of Brycomp
// runs. A host loads nothing for it, and Brycomp needs no runtime of a host's.
//
// ## The host
//
// What only the framework knows, handed to every function that needs it as
// its first argument, `host`. Each member is what the framework's own compiler
// spells its way, a host built on Svelte beside one built on Vue:
//
//   name     the tool the author ran, which every refusal is said under,
//            `'tool'` for `tool — …`.
//   bridge   the module the generated code imports its runtime from,
//            `'tool/bridge'`.
//   runtime  the name the generated code reaches each function of that runtime
//            by, keyed by the function's own: `{ withNamespace:
//            '__withNamespace', pyError: '__pyError', … }` where the
//            component's own names share the scope, `{ withNamespace:
//            'withNamespace', … }` where they do not. `templateDots`, for a
//            host that asks it, writes a dot as a call to `readAttr` and to
//            `writeAttr`, under the names given here.
//   state    how a name of the module becomes one of the framework's states,
//            four functions of the variable that holds it, `cell`:
//              cell(name, cell, bump)  what declares it, with the `bump` a
//                                      change in place calls to move its
//                                      readers: `let x = $state.raw()` and a
//                                      revision, `const x = shallowRef()` and
//                                      `triggerRef(x)`;
//              value(cell)             what it holds: `x`, `x.value`;
//              read(name, cell)        what it holds, read so that a bump
//                                      moves the reader: `(__rev_x, x)`,
//                                      `x.value`;
//              write(cell, value)      the assignment: `x = v`, `x.value = v`.
//   reserved the framework's own words, which an author may not redefine:
//              words  each `{ name, component }`, `component` true for a word
//                     reserved in a component alone: `derived`, `effect`,
//                     `export`, … as a host built on Svelte and one built on
//                     Vue both lock them;
//              said   the sentence the refusal ends on, which names what the
//                     host provides that an author may still shadow.
//   instead  what stands in for a module of Python's standard library, which
//            does not ship, keyed by the module and said after the refusal of
//            its import: `{ json: '`from_json(text)` reads JSON …', … }`.
//   pathOption
//            the name of the host's option that lists where a module is
//            found besides the component's own folder, which a refusal of an
//            import tells the author to add to: `'path'`. The name alone, not
//            the folders it lists.
//   rewrite  optional: the host's own syntax made Python, before the
//            translation, `rewrite(text, { source, lineOffset, component,
//            bound })` answering the text, `bound` the names `importjs`
//            binds. A host with no syntax of its own leaves it out.
//   runes    optional: the names the framework's compiler reads as its own
//            once a binding of the module takes them, `$effect` read as a
//            store once `effect` is bound: `['state', 'derived', 'effect', …]`
//            for Svelte, none for Vue. A JavaScript import of one is held
//            under another variable, and Python reads it under its own name.
//
// Whatever names a thing the host provides belongs to the host, messages
// included.
import 'bryvend';
import 'bryvend/compiler';

// The common half of a compile, in its order (`compile.js`).
export { compile } from './compile.js';

// Python's text and its expressions.
export {
    atomic,
    replaceLiterals,
    NAME_CHAR,
    NAME,
    CONVERSION,
    pythonName,
    sameName,
    targetTree,
    freeNames,
    callsAnything,
    computing,
    costly,
    handedLate
} from './expressions.js';

// The functions a template's expressions compile to, and the tool for a host
// whose template's dot reads a key as well as an attribute.
export { EXPR_PREFIX, templateDots } from './template.js';

// A Python error made a refusal on its line.
export { refuse } from './errors.js';

// The namespace the code runs in and the names it imports its runtime by, how
// a name of the module is held, and what a name of the generated module may
// be.
export {
    NS,
    runtimeAliases,
    PROTO,
    namespaceObject,
    NEXT_VALUE,
    bump,
    stateCell,
    stateBinding,
    JS_RESERVED,
    COMPILER_PREFIX,
    PY_NAME,
    refuseHostWords,
    refuseReserved
} from './translation.js';

// Python's scopes over a module.
export { BODIES, walkScoped, symbolTable, scopeIn, isGlobalScope, moduleBinds, globalReads } from './scopes.js';

// What a module exports.
export {
    children,
    declaredExports,
    exportChecks,
    unboundRefusals,
    moduleExports,
    liveExportLines,
    moduleLoad
} from './exports.js';

// The JavaScript a source imports, and the names JavaScript gives the module.
export { continuedLines, declaredJsImports, takeImportJs, jsImportLine, jsNameBindings } from './imports.js';
