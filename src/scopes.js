// Python's scopes over a module's AST: every node with the scope it is
// evaluated in, the symbol table Brython builds, and where a name resolves.
import { engine } from './translation.js';

const COMPREHENSIONS = ['ListComp', 'SetComp', 'DictComp', 'GeneratorExp'];

// Where a statement keeps the statements it holds. `items` is a `with`'s
// context managers, which hold no body of their own but do sit on the path.
const BODIES = ['body', 'orelse', 'finalbody', 'handlers', 'cases', 'items'];

// Every node of a module's AST, handed to `enter` with the line of the
// statement it is in, its parent and grandparent, and the scope its value is
// evaluated in: a `def`, a `class`, a lambda or a comprehension, or null for
// the module. What Python evaluates where the definition stands, a default, a
// decorator, an annotation, a base, a comprehension's first iterable, belongs
// to the enclosing scope, as it does in Python. A constant's value is a Python
// object and not a part of the tree, so it is not walked.
function walkScoped(body, enter) {
    const $B = globalThis.__BRYTHON__;
    const seen = new Set();
    const is = (node, ...names) => names.some((one) => node instanceof $B.ast[one]);
    let parent = null;
    let grand = null;

    const visit = (node, scope, line) => {
        if (node === null || typeof node !== 'object' || seen.has(node)) return;
        if (Array.isArray(node)) {
            for (const one of node) visit(one, scope, line);
            return;
        }
        seen.add(node);

        const at = typeof node.lineno === 'number' ? node.lineno : line;
        enter(node, scope, at, parent, grand);
        if (node instanceof $B.ast.Constant) return;

        const [outer, outerGrand] = [parent, grand];
        [parent, grand] = [node, parent];
        try {
            visitInside(node, scope, at);
        } finally {
            [parent, grand] = [outer, outerGrand];
        }
    };

    const visitInside = (node, scope, at) => {
        if (is(node, 'FunctionDef', 'AsyncFunctionDef', 'Lambda')) {
            const args = node.args ?? {};
            const params = [...(args.posonlyargs ?? []), ...(args.args ?? []), ...(args.kwonlyargs ?? [])];
            visit(node.decorator_list, scope, at);
            visit(args.defaults, scope, at);
            visit(args.kw_defaults, scope, at);
            visit(node.returns, scope, at);
            for (const one of [...params, args.vararg, args.kwarg]) visit(one?.annotation, scope, at);
            visit(node.body, node, at);
            return;
        }

        if (is(node, 'ClassDef')) {
            visit(node.decorator_list, scope, at);
            visit(node.bases, scope, at);
            visit(node.keywords, scope, at);
            visit(node.body, node, at);
            return;
        }

        if (is(node, ...COMPREHENSIONS)) {
            const [first, ...rest] = node.generators;
            visit(first.iter, scope, at);
            visit([first.target, first.ifs, rest, node.elt, node.key, node.value], node, at);
            return;
        }

        for (const [key, value] of Object.entries(node)) if (key !== 'parent') visit(value, scope, at);
    };

    visit(body, null, undefined);
}

// A name is the builtin where no scope binds it: not the block's own, not an
// enclosing function's, not the module's.
const builtinIn = (table, bound) => (name, scope) => {
    const block = scope === null ? null : table.blockOf(scope);
    if (block !== null && block !== undefined && !isGlobalScope(scopeIn(block, name))) return false;
    return !bound.has(name);
};

// Python's symbol table for a module, built once per compile: the module's
// block, and every block by the AST node it stands for, which Brython marks
// with `$B.ID` as it builds the table.
function symbolTable(ast, source) {
    const $B = engine();
    const top = $B._PySymtable_Build(ast, source, $B.future_features(ast, source));
    const byNode = new Map();

    const index = (block) => {
        byNode.set(block.id, block);
        block.children.forEach(index);
    };
    index(top);

    return { top, blockOf: (node) => byNode.get(node[$B.ID]) };
}

// Where a name resolves in a block: its scope, `GLOBAL_EXPLICIT` and
// `GLOBAL_IMPLICIT` meaning the module's.
const scopeIn = (block, name) => {
    const $B = globalThis.__BRYTHON__;

    return ($B.str_dict_get(block.symbols, name, 0) >> $B.SYMBOL_FLAGS.SCOPE_OFFSET) & $B.SYMBOL_FLAGS.SCOPE_MASK;
};

const isGlobalScope = (scope) => {
    const flags = globalThis.__BRYTHON__.SYMBOL_FLAGS;

    return scope === flags.GLOBAL_EXPLICIT || scope === flags.GLOBAL_IMPLICIT;
};

// The names a block itself binds, whatever binds them: an assignment, an
// import, a `def`, a walrus in a default, a `match` capture. Python's answer,
// read off the block.
const blockBinds = (block) => {
    const $B = globalThis.__BRYTHON__;
    const bound = new Set();
    for (const { key, value } of $B.builtins.dict.$iter_items(block.symbols)) {
        if (value & $B.SYMBOL_FLAGS.DEF_BOUND) bound.add(key);
    }
    return bound;
};

const moduleBinds = (table) => blockBinds(table.top);

// The names a module reads as globals. Asked of the AST, because the question
// is about a **name**, and a `Constant` whose value happens to read the same is
// not one. Nor is every `Name`: a parameter or a local of that spelling reads
// the function's own binding, not the module's. So the answer is Python's own,
// its symbol table: a name the module reads is one some block uses with a
// global scope, explicit or implicit.
function globalReads(table) {
    const $B = globalThis.__BRYTHON__;
    const flags = $B.SYMBOL_FLAGS;
    const found = new Set();

    const visit = (block) => {
        for (const { key, value } of $B.builtins.dict.$iter_items(block.symbols)) {
            const scope = (value >> flags.SCOPE_OFFSET) & flags.SCOPE_MASK;
            if (value & flags.USE && isGlobalScope(scope)) found.add(key);
        }
        block.children.forEach(visit);
    };

    visit(table.top);
    return found;
}

export {
    COMPREHENSIONS,
    BODIES,
    walkScoped,
    builtinIn,
    symbolTable,
    scopeIn,
    isGlobalScope,
    blockBinds,
    moduleBinds,
    globalReads
};
