// Python's text and its expressions. First Python's lexical rule for what is
// not code, a comment and a string literal, read once for every scanner that
// walks Python text, the template's and the compiler's alike. Then the
// expressions of a template: which names one reads, and when each is read. A
// template hands an expression the names its blocks declare, read before the
// expression runs or, where reading one runs code, read where the expression
// reads it, as Python does. What reads names off an expression, and decides
// which are read ahead, and nothing of the markup around it.
//
// One rule, so that a grammar learned here is learned everywhere: a `}` inside a
// **comment** or a **triple-quoted** string ends nothing, and neither does the
// quote of an f-string field that reuses its own, which Python takes since 3.12.

// How far to step over a Python comment or string literal starting at `at`, and
// 0 when neither starts there.
//
// `onField(from, to)`, when given, is told where the expression of each field
// of an f-string lies, nested fields of a specification included: the one place
// that knows the three grammars apart is the one that says where the code is.
export function atomic(source, at, onField) {
    const c = source[at];

    if (c === '#') {
        const end = source.indexOf('\n', at);

        return (end === -1 ? source.length : end) - at;
    }

    if (c !== '"' && c !== "'" && c !== '`') return 0;

    // Three of the same character is a delimiter of its own, and inside it a
    // lone quote is text.
    const fence = source.startsWith(c.repeat(3), at) ? c.repeat(3) : c;

    // An f-string is three grammars in one literal, and the scanner has to know
    // which one it is standing in.
    //
    //  - **text**, where `{{` and `}}` are an escaped brace;
    //  - a **field**, `{…}`, which is Python and may since 3.12 reuse the
    //    delimiter of the string holding it: `f"{ "}" }"` is valid;
    //  - a **format specification**, after the field's own `:`, where `#` is an
    //    option and `'` a fill character rather than a comment and a string,
    //    and where a `{…}` is a field again: `f"{3:{2}}"`.
    //
    // A stack rather than counters, because a `{` means different things in
    // each: at the top it opens a field, inside a field it opens a dict or a
    // set, inside a specification it opens a nested field. Counting braces and
    // brackets alone read the `:` of `f"{ {'x': '}'} }"` as a specification's,
    // and the brace inside that string then closed something.
    const formatted = interpolated(source, at);
    const frames = [];
    const inner = () => frames[frames.length - 1];

    for (let i = at + fence.length; i < source.length; i++) {
        const here = formatted ? inner() : undefined;
        const spec = here !== undefined && here.spec;

        // A backslash hides the character after it, so that `"\""` is one string
        // and not two, **except a brace**, which it cannot hide: the escape for
        // a brace is `{{`, and a backslash before one leaves it opening a field:
        // CPython 3.14 answers `\5` for `rf"\{ x }"` with `x = 5`, and the same,
        // with a warning about the escape, without the `r`.
        if (!spec && source[i] === '\\' && !(formatted && '{}'.includes(source[i + 1]))) {
            i++;
            continue;
        }

        if (formatted) {
            if (frames.length === 0 && (source.startsWith('{{', i) || source.startsWith('}}', i))) {
                i++;
                continue;
            }

            if (source[i] === '{') {
                frames.push({ field: frames.length === 0 || spec, spec: false, brackets: 0, start: i + 1 });
                continue;
            }

            if (source[i] === '}' && frames.length > 0) {
                const closed = frames.pop();

                if (closed.field && !closed.spec) onField?.(closed.start, i);
                continue;
            }

            if (here !== undefined && !spec) {
                if ('(['.includes(source[i])) here.brackets++;
                else if (')]'.includes(source[i])) here.brackets--;
                else if (source[i] === ':' && here.field && here.brackets === 0) {
                    here.spec = true;
                    onField?.(here.start, i);
                    continue;
                }

                const nested = atomic(source, i);

                if (nested > 0) {
                    i += nested - 1;
                    continue;
                }
            }

            // Inside a specification nothing but a brace is syntax, and the
            // fence cannot end the string there either.
            if (spec) continue;
        }

        if (frames.length === 0 && source.startsWith(fence, i)) return i + fence.length - at;
    }

    return source.length - at;
}

// Whether the quote at `at` opens an f-string, read from the prefix letters
// before it. Two at most (`rf`, `fr`), and not the tail of a longer name, so
// the `f` of `def"` is not one.
function interpolated(source, at) {
    let i = at - 1;
    let prefix = '';

    while (i >= 0 && prefix.length < 2 && /[fFtTrRbBuU]/.test(source[i])) {
        prefix = source[i] + prefix;
        i--;
    }

    if (i >= 0 && /[A-Za-z0-9_]/.test(source[i])) return false;

    // A t-string (PEP 750) has the fields of an f-string.
    return /[fFtT]/.test(prefix);
}

// `source` with every comment and string literal replaced by what `replace`
// returns for it, the code between them kept as written: the text a scanner
// reads when it wants the code alone.
export function replaceLiterals(source, replace) {
    let out = '';

    for (let i = 0; i < source.length; ) {
        const step = atomic(source, i);

        if (step > 0) {
            out += replace(source.slice(i, i + step));
            i += step;
        } else out += source[i++];
    }

    return out;
}

// What a name is made of, after its first character.
export const NAME_CHAR = '\\p{XID_Continue}';

// A name, spelled the way Python spells one, and the single source every pattern
// that reads a name is built from.
//
// `\w` is ASCII in JavaScript, and `année` or `ligné` is a name to Python. Every
// site that asks "is this a name" reads this one class, and nothing spells it
// out again.
//
// Python's own classes, `XID_Start` and `XID_Continue`, the ones
// `str.isidentifier` answers by: marks are in them because a name in Vietnamese
// or Devanagari carries them, and `℘` or `·` because Python takes them. `u` is
// required for `\p{…}` to mean anything at all.
export const NAME = `[\\p{XID_Start}_][${NAME_CHAR}]*`;

// The names an expression **reads**, which is not every word in its text.
//
// A declaration binds the words its pattern holds, and a pattern holds no
// strings and no attributes, so one regular expression is the whole of it
// there. An expression is not that: two kinds of word in one are not a
// reference.
//
//   a **string** or a comment   `greet("count")` does not read `count`
//   an **attribute**            `row.label` reads `row`; `label` is the object's
//
// A name an expression does not read may be in the temporal dead zone of the
// declaration it sits in: in `{#each rows as [label="total", total=0]}`,
// reading `total` for the first default would read it before it exists.
//
// **An f-string is code, in its fields and nowhere else.** `f"{count} left"`
// reads `count`, so skipping the literal whole would cost the block the very
// subscription it depends on; reading all of it would count `left`. `atomic`
// says where each field's expression lies, since it is the scanner that tells a
// field from a format specification, where `#` is an option and `'` a fill
// character: `f"{value:#x}"` and `f"{value:'>4}"` read `value` and nothing else.
// A conversion, `!r`, closes the expression as well.
export const CONVERSION = /![rsa]\s*$/;

// A name as Python reads it, by the engine's own rule, the one its parser reads
// every identifier by: normalized to NFKC when it holds a character past
// ASCII, so `ﬁeld` and `field` are one name. The markup compares names so and
// never rewrites one it emits: a name a block declares is a JavaScript variable
// as well, and JavaScript knows it by the spelling it was declared under.
export const pythonName = (name) => globalThis.__BRYTHON__._PyPegen.new_identifier(null, name);

// Two names as Python compares them (`pythonName`): `ﬁeld` declared and
// `field` read are one name. Every question of which name an expression reads
// is asked through this, and no spelling is compared as it was written.
export const sameName = (one, other) => pythonName(one) === pythonName(other);

const referenced = (text) => {
    const found = new Set();
    const name = new RegExp(`^${NAME}`, 'u');
    let at = 0;

    while (at < text.length) {
        const fields = [];
        const skip = atomic(text, at, (from, to) => fields.push(text.slice(from, to)));

        if (skip > 0) {
            for (const field of fields) {
                for (const one of referenced(field.replace(CONVERSION, ''))) found.add(one);
            }

            at += skip;
            continue;
        }

        const word = text.slice(at).match(name);

        if (word === null) {
            at += 1;
            continue;
        }

        if (!/\.\s*$/.test(text.slice(0, at))) found.add(word[0]);

        at += word[0].length;
    }

    return [...found];
};

// An expression as Python reads it, by Brython's parser, which the door loads
// before any file of Bryc runs. A binding's target: `(amount)` is the `Name`
// `amount`, and `bag["selected"]`, `bag[ "selected" ]` and `bag['selected']`
// are one `Subscript`. And where an `{#await}` ends. Null for text that does
// not parse, which the compiler refuses where it is written once it compiles
// it.
export function targetTree(expr) {
    const $B = globalThis.__BRYTHON__;

    try {
        return $B._PyPegen.run_parser(new $B.Parser(expr.trim(), '<target>', 'eval')).body;
    } catch {
        return null;
    }
}

// And the names it reads **from outside itself**, which is what a template
// expression is handed: a lambda's parameters are its own, and so is every
// target of a comprehension, in each of its clauses but the first iterable, as
// CPython scopes them. `(lambda x: x)(7)` reads no `x` of the template's;
// `(lambda y=x: y)()` reads one in its default, and `[x for x in x]` in its
// first iterable. Handed every word, a snippet's parameter the expression
// shadows was read all the same, before the expression ran, and its default
// with it, where Svelte reads none. Read off the tree the engine's parser
// makes, and off the text where it makes none, which the compiler then
// refuses. A walrus's target is taken as read, as it was. Its parentheses let
// it run over lines, as it does between braces.
export const freeNames = (text) => {
    const tree = targetTree(`(${text}\n)`);

    if (tree === null) return referenced(text);

    const ast = globalThis.__BRYTHON__.ast;
    const found = new Set();
    const COMPREHENSIONS = [ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp];
    const targets = (node, into) => {
        if (node instanceof ast.Name) into.add(node.id);
        else if (node instanceof ast.Tuple || node instanceof ast.List) for (const one of node.elts) targets(one, into);
        else if (node instanceof ast.Starred) targets(node.value, into);
    };
    const visit = (node, bound) => {
        if (Array.isArray(node)) {
            for (const one of node) visit(one, bound);
            return;
        }
        if (node === null || typeof node !== 'object' || !Array.isArray(node.constructor?._fields)) return;

        if (node instanceof ast.Name) {
            if (!bound.has(node.id)) found.add(node.id);
            return;
        }

        if (node instanceof ast.Lambda) {
            const { args } = node;
            const own = new Set(bound);

            visit([args.defaults, args.kw_defaults], bound);
            for (const one of [...args.posonlyargs, ...args.args, ...args.kwonlyargs, args.vararg, args.kwarg]) {
                if (one) own.add(one.arg);
            }
            visit(node.body, own);
            return;
        }

        if (COMPREHENSIONS.some((kind) => node instanceof kind)) {
            const [first, ...rest] = node.generators;
            const own = new Set(bound);

            visit(first.iter, bound);
            for (const one of node.generators) targets(one.target, own);
            for (const one of node.generators) visit([one.target, one.ifs], own);
            visit(rest.map((one) => one.iter), own);
            visit([node.elt, node.key, node.value], own);
            return;
        }

        for (const field of node.constructor._fields) visit(node[field], bound);
    };

    visit(tree, new Set());
    return [...found];
};

// Whether an expression calls anything, a function of the author's or a
// comprehension, which runs one over what it iterates; a lambda's body runs
// later and counts for nothing. What Svelte asks of a `{@render}` argument
// before it holds its value: one that calls something is computed once until
// what it reads changes, any other is read again at each read of its
// parameter. Text that does not parse calls something, which the compiler
// then refuses.
export const callsAnything = (text) => {
    const tree = targetTree(`(${text}\n)`);

    if (tree === null) return true;

    const ast = globalThis.__BRYTHON__.ast;
    const CALLS = [ast.Call, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp];
    let calls = false;
    const visit = (node) => {
        if (calls) return;
        if (Array.isArray(node)) {
            for (const one of node) visit(one);
            return;
        }
        if (node === null || typeof node !== 'object' || !Array.isArray(node.constructor?._fields)) return;

        if (CALLS.some((kind) => node instanceof kind)) {
            calls = true;
            return;
        }
        if (node instanceof ast.Lambda) {
            visit([node.args.defaults, node.args.kw_defaults]);
            return;
        }
        for (const field of node.constructor._fields) visit(node[field]);
    };

    visit(tree);
    return calls;
};

// The names of a scope whose read may run code, the author's or a default's:
// a name a pattern unpacks, which reads a key or an attribute, one whose
// parameter holds a default, and a derived the markup declares. And every
// snippet parameter, bare or not: Svelte hands one as a function of the
// `{@render}` argument, which reading it runs. A row, an index or a state cell
// is read as it is held. Marked on the scope that declares them, which the
// markup's scopes hold.
export const computing = (scope, names = []) => {
    if (scope) for (const one of names) (scope.computed ??= new Set()).add(one);
};

// Whether a name, in the scope that declares it, is one (`computing`).
export const costly = (scope, declared) => scope.computed?.has(declared) === true;

// How many times a tree names `name`, anywhere in it.
const occurrences = (tree, name) => {
    const ast = globalThis.__BRYTHON__.ast;
    let count = 0;
    const visit = (node) => {
        if (Array.isArray(node)) {
            for (const one of node) visit(one);
            return;
        }
        if (node === null || typeof node !== 'object' || !Array.isArray(node.constructor?._fields)) return;

        if (node instanceof ast.Name && pythonName(node.id) === name) count += 1;
        for (const field of node.constructor._fields) visit(node[field]);
    };

    visit(tree);
    return count;
};

// Whether an expression reads `name` before it runs anything. Read ahead, a
// name whose read runs code (`costly`) then runs it where Python would: first,
// and on every run. The expression is walked in Python's order of evaluation,
// and the first of the two decides. Each node runs code once it has read its
// operands, save a name, a constant and its attribute, a tuple, a list, a
// slice, an f-string, a keyword and a lambda, whose body runs later. A name
// `runs` answers for runs code where it is read, a derived of the script or a
// prop, as `total` ran its body after `x`'s default in `[total, x]`. A node
// that may skip what follows reads its first operand alone before it runs:
// the test of a conditional, the first value of an `and` or an `or`, the
// first comparison of a chain, the first iterable of a comprehension; and so,
// taken as hashing what it has read, does a dict or a set. So `row["label"]`,
// `fmt(row)` and `"#" + row` read `row` first, and `first() + row`,
// `"a" if c else row`, `[row for _ in rows]` and `[total, row]` do not. A
// walrus's target is written, not read, and a `**` merge, a keyword the
// engine's tree leaves without a name, runs code.
//
// A `target` is the target of a write. Python reads the value first, then the
// owner of an attribute or an item: a target that unpacks runs code before it
// reads anything, and a name is written, not read.
//
// And the name is read once: read ahead, two reads were one, where each runs
// its code, and a parameter read again answers what its argument holds then,
// `{x - step() - x}` reading `x` before and after `step()`.
const readAhead = (text, name, runs, target = false) => {
    const tree = targetTree(`(${text}\n)`);

    if (tree === null) return false;

    const ast = globalThis.__BRYTHON__.ast;

    if (target && !(tree instanceof ast.Attribute || tree instanceof ast.Subscript)) return false;
    if (occurrences(tree, pythonName(name)) !== 1) return false;

    const COMPREHENSIONS = [ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp];
    const PURE = [ast.Constant, ast.Tuple, ast.List, ast.Slice, ast.JoinedStr, ast.keyword, ast.Lambda];
    const sought = pythonName(name);
    let answer = null;
    const decide = (value) => {
        if (answer === null) answer = value;
    };
    const visit = (node) => {
        if (answer !== null) return;
        if (Array.isArray(node)) {
            for (const one of node) visit(one);
            return;
        }
        if (node === null || typeof node !== 'object' || !Array.isArray(node.constructor?._fields)) return;

        if (node instanceof ast.Name) {
            if (pythonName(node.id) === sought) decide(node.ctx instanceof ast.Load);
            else if (runs(node.id)) decide(false);
            return;
        }

        if (node instanceof ast.Lambda) visit([node.args.defaults, node.args.kw_defaults]);
        else if (node instanceof ast.IfExp) visit(node.test);
        else if (node instanceof ast.BoolOp) visit(node.values[0]);
        else if (node instanceof ast.Compare) visit([node.left, node.comparators[0]]);
        else if (COMPREHENSIONS.some((kind) => node instanceof kind)) visit(node.generators[0].iter);
        else if (node instanceof ast.Dict) visit([node.keys[0], node.values[0]]);
        else if (node instanceof ast.Set) visit(node.elts[0]);
        else if (node instanceof ast.NamedExpr) visit([node.value, node.target]);
        else if (node instanceof ast.Attribute && node.value instanceof ast.Constant) return;
        else {
            for (const field of node.constructor._fields) {
                if (field !== 'ctx' && field !== 'op') visit(node[field]);
            }
        }

        if (!PURE.some((kind) => node instanceof kind) || (node instanceof ast.keyword && !node.arg)) decide(false);
    };

    visit(tree);
    return answer === true;
};

// Whether an expression is handed its names late, each as a function that
// reads it, or each read ahead. `args` are the names the template hands it,
// `costly` says which of them runs code when read, and `scriptRuns` which of
// the names it is not handed, the script's or a builtin's, does; `target` is
// the target of a write.
//
// Late when one runs code, so the name is read where Python reads it: never in
// a branch Python does not take, as in Svelte's own `true ? 7 : x`, and after
// what the expression reads before it. Read before the call, `{7 if True else
// x}` read a snippet's parameter, and its default with it, and failed on what
// the branch excluded; and `{first() + x}` ran `x`'s default before `first()`.
// Ahead otherwise: a row read ahead is the row Python reads, and a call for each
// read cost a row's update a fifth more. And ahead when one such name is read
// before the expression runs anything (`readAhead`): `{item["n"] * 2}` reads
// `item` first, where a read ahead runs its code too, and handed late, every
// row a snippet renders paid the fifth.
export const handedLate = (text, args, costly, scriptRuns, target = false) => {
    const running = args.filter(costly);
    const runs = (name) => !args.some((one) => sameName(one, name)) && scriptRuns(name);

    return running.length > 1 || (running.length === 1 && !readAhead(text, running[0], runs, target));
};
