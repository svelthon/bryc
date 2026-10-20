// The common half of a compile, in its order: a component's script joined with
// the functions of its template, the JavaScript it imports lifted out, the
// host's own syntax rewritten (`host.rewrite`), the Python translated, the
// names JavaScript gives the module read as its own, the imports the runtime
// cannot satisfy refused, and the module that holds the code. What a host makes
// of it, the states, the bindings and the rest of its script, is the host's.
import { componentSource } from './template.js';
import { symbolTable } from './scopes.js';
import { compilePython, translation, moduleNamespace, moduleCode, sourceMap } from './translation.js';
import {
    takeImportJs,
    jsImportsOf,
    moduleImports,
    refuseRelativeImports,
    refuseMissingModules,
    refuseTypeParameters,
    refuseBoundImports,
    refuseLibraryCalls
} from './imports.js';

// `text` is the script as its author wrote it, and for a component `defs`,
// `defLines` and `defColumns` the functions its template compiled to, with
// where in the file each stands (`componentSource`). `named` is the module
// Python imports it by, null for a component, which nobody imports. `jsNames`
// are the names JavaScript beside it gives the module. `resolves` answers
// whether an imported name is one of the project's files, and without it the
// imports are not checked against the project. `sourceContent` is what the
// source map holds, the text the author wrote.
//
// Everything the host reads afterwards comes back: the text compiled, the
// translation's root and the module's symbol table, the code and the module
// that holds it, its source map, the JavaScript imports and the modules the
// source imports, and where the template's functions stand.
export function compile(
    host,
    text,
    {
        name,
        source = name,
        component = false,
        named = null,
        defs = [],
        defLines = [],
        defColumns = [],
        lineOffset = 0,
        jsNames = [],
        resolves = null,
        sourceContent = null
    }
) {
    // Kept for the error path: the block as the author typed it, before the
    // generated functions join it at column zero.
    const authored = component ? text : '';
    let src = text;
    let ranges = [];
    let templateLine;

    if (component) ({ src, ranges, templateLine } = componentSource(src, defs, defLines, defColumns));

    // Neither `importjs` nor the host's own syntax is Python, and Brython would
    // rightly refuse them: both are rewritten before the translation, the host's
    // told which names the lifted imports bind.
    const lifted = takeImportJs(host, src, source, lineOffset, component);
    const bound = new Set(lifted.imports.flatMap((one) => one.entries.map((entry) => entry.local)));

    src = host.rewrite === undefined ? lifted.source : host.rewrite(lifted.source, { source, lineOffset, component, bound });

    const translating = { name, source, named, lineOffset, authored, ranges, src };
    const root = compilePython(host, src, translating);

    // Python's symbol table, which says what every name means in every scope.
    const table = symbolTable(root._ast, source);

    const jsImports = jsImportsOf(host, root._ast, table, source, lineOffset, lifted.imports);
    const jsImported = jsImports.flatMap((one) => one.entries.map((entry) => entry.local));

    // The names JavaScript gives the module, its imports and those beside it,
    // read as the module reads its own.
    const js = translation(host, root, [...jsImported, ...jsNames], translating);
    const namespace = moduleNamespace(host, js, source, named);

    const { found: importedAt, relative } = moduleImports(root._ast);

    refuseRelativeImports(host, relative, source, lineOffset);
    if (resolves) refuseMissingModules(host, importedAt, resolves, source, lineOffset);
    refuseTypeParameters(host, root._ast.body, source, lineOffset);
    refuseBoundImports(host, root._ast, table, jsImported, source, lineOffset);
    refuseLibraryCalls(host, root._ast, table, source, lineOffset);

    const module = moduleCode(host, { js, namespace, source });

    return {
        src,
        root,
        table,
        js,
        namespace,
        module,
        map: sourceMap(module, source, sourceContent ?? src, lineOffset),
        jsImports,
        jsImported,
        imported: [...importedAt.keys()],
        ranges,
        templateLine
    };
}
