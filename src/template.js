// The Python a template's expressions compile to: one function per expression,
// which the template's pass appends to the module under a name of its own
// (`EXPR_PREFIX`), and the rule of the template's text that this rewrites into
// it, the dot that reads a key as well as an attribute.
import { engine } from './translation.js';

// The hidden functions the template's pass appends, one per expression it
// compiled. The pass names them so, and Bryc reads them by it; the two have to
// agree. After the prefix, the pass may say how the value is read (`set_` for
// the write half of a binding), and a `_late` at the end says the function's
// parameters arrive as functions.
const EXPR_PREFIX = '__expr_';

// In the markup, and only there, the dot finds a key as well as an attribute:
// `{pep.title}` reads a dict. The same text in the `<script>` stays plain Python
// and raises.
//
// A rule of the template's **text**, so it is applied to the text of the
// functions the template's pass wrote: every attribute read becomes
// `__getattr(value, "name")`, and the assignment a `bind:` writes becomes
// `__setattr(value, "name", new)`. A function of the script that the template
// calls keeps plain Python, and a lambda written in the template keeps the rule
// however late it runs. The places come from Brython's own parser, in
// characters, f-string fields included.
function templateDots(def) {
    const $B = engine();
    let tree;

    try {
        tree = $B._PyPegen.run_parser(new $B.Parser(def, '<template>', 'file'));
    } catch {
        // Left as written: the real compile reports it, with the real file name.
        return def;
    }

    const starts = [0];
    for (let i = 0; i < def.length; i++) if (def[i] === '\n') starts.push(i + 1);

    const begin = (node) => starts[node.lineno - 1] + node.col_offset;
    const end = (node) => starts[node.end_lineno - 1] + node.end_col_offset;

    // The dot of `value.name`: behind the name, across any space between them.
    // Bounded, so a position Brython stopped giving the way this reads it says
    // so rather than walking off the start of the text for ever.
    //
    // Behind the name as written, which a name never holds a dot of, and not
    // `node.attr.length` back: the attribute is the name normalized, as Python
    // reads an identifier, so `box.ﬁeld` reads `field`, one character longer
    // than its text.
    const dot = (node) => {
        let i = end(node) - 1;
        while (i >= 0 && def[i] !== '.') i -= 1;
        if (i < 0) throw new Error(`bryc — no dot found before \`${node.attr}\` in a template expression`);
        return i;
    };

    // `size` orders the insertions made at one place: the widest node's text
    // has to come first, so it is applied last.
    const edits = [];
    const insert = (at, text, node) => edits.push({ from: at, to: at, text, size: end(node) - begin(node) });
    const replace = (from, to, text) => edits.push({ from, to, text, size: 0 });
    // Two texts around a node, outside everything the node holds: the opening
    // one before every opening text at its start, the closing one after every
    // closing text at its end. Half a character wider than the node is what
    // orders them so.
    const wrap = (node, before, after) => {
        const size = end(node) - begin(node) + 0.5;

        edits.push({ from: begin(node), to: begin(node), text: before, size });
        edits.push({ from: end(node), to: end(node), text: after, size: -size });
    };

    // A function whose parameters arrive as functions, named `_late` by the
    // template's pass: each read of one becomes a call, except where a lambda
    // or a comprehension binds the same name for itself.
    // The write half of a binding is handed the value written first, as
    // itself, and only the names after it so.
    const [def0] = tree.body;
    const late = def0 instanceof $B.ast.FunctionDef && def0.name.startsWith(EXPR_PREFIX) && def0.name.endsWith('_late');
    const lazy = late
        ? new Set(def0.args.args.slice(def0.name.startsWith(`${EXPR_PREFIX}set_`) ? 1 : 0).map((one) => one.arg))
        : new Set();

    // The names a target binds: `x`, `(k, v)`, `*rest`.
    const targets = (target, names = []) => {
        if (target instanceof $B.ast.Name) names.push(target.id);
        if (target instanceof $B.ast.Starred) targets(target.value, names);
        for (const one of target.elts || []) targets(one, names);
        return names;
    };

    const within = (shadowed, names) => new Set([...shadowed, ...names]);

    // The names a walrus binds in the scope of `node`: a comprehension's walrus
    // binds in the scope around it, a nested lambda's in its own.
    const walrused = (node, names = [], met = new WeakSet()) => {
        if (!node || typeof node !== 'object' || met.has(node) || node instanceof $B.ast.Lambda) return names;
        met.add(node);
        if (node instanceof $B.ast.NamedExpr) names.push(node.target.id);
        for (const key of Object.keys(node)) if (key !== 'parent') walrused(node[key], names, met);
        return names;
    };

    const seen = new WeakSet();

    // Python's scopes, not the tree's: every child of a node does not see the
    // same names. A lambda's defaults are read where the lambda is written and
    // its body where it runs, with every parameter bound, and every name a walrus
    // binds there, which is local to the whole body. A comprehension's first
    // iterable is read outside it, and each target binds for what follows it.
    const scoped = (node, shadowed) => {
        if (node instanceof $B.ast.Lambda) {
            const args = node.args;
            const params = [...args.posonlyargs, ...args.args, ...args.kwonlyargs]
                .concat(args.vararg ? [args.vararg] : [], args.kwarg ? [args.kwarg] : [])
                .map((one) => one.arg);

            for (const one of [...args.defaults, ...args.kw_defaults]) visit(one, shadowed);
            visit(node.body, within(shadowed, [...params, ...walrused(node.body)]));
            return true;
        }

        const comprehension =
            node instanceof $B.ast.ListComp ||
            node instanceof $B.ast.SetComp ||
            node instanceof $B.ast.DictComp ||
            node instanceof $B.ast.GeneratorExp;

        if (!comprehension) return false;

        let inner = shadowed;

        node.generators.forEach((one, index) => {
            visit(one.iter, index === 0 ? shadowed : inner);
            inner = within(inner, targets(one.target));
            for (const test of one.ifs) visit(test, inner);
        });

        for (const key of ['elt', 'key', 'value']) if (node[key]) visit(node[key], inner);
        return true;
    };

    const visit = (node, shadowed = new Set()) => {
        if (!node || typeof node !== 'object' || seen.has(node)) return;
        seen.add(node);

        if (scoped(node, shadowed)) return;

        if (node instanceof $B.ast.Name && node.ctx instanceof $B.ast.Load && lazy.has(node.id) && !shadowed.has(node.id)) {
            insert(end(node), '()', node);
        }

        // A walrus that binds one of those names binds the parameter itself,
        // in a comprehension and in a lambda's default as much as here, and
        // every read of it is a call. So it stores a function that answers its
        // value, and gives the value: `(name := (lambda value: lambda:
        // value)(new))()`, which a read after it calls as one before it calls
        // the template's.
        if (node instanceof $B.ast.NamedExpr && lazy.has(node.target.id) && !shadowed.has(node.target.id)) {
            wrap(node, '(', ')()');
            wrap(node.value, '(lambda value: lambda: value)(', ')');
        }

        const [target] = node instanceof $B.ast.Assign ? node.targets : [];

        if (node instanceof $B.ast.Assign && node.targets.length === 1 && target instanceof $B.ast.Attribute) {
            // The target may stand between parentheses, `(row.label) = new`:
            // the call opens before them and they close around the object.
            const closers = def.slice(end(target), begin(node.value)).replace(/[\s=]/g, '');
            insert(begin(node), '__setattr(', node);
            replace(dot(target), begin(node.value), `${closers}, ${JSON.stringify(target.attr)}, `);
            insert(end(node.value), ')', node.value);
            visit(target.value, shadowed);
            visit(node.value, shadowed);
            return;
        }

        if (node instanceof $B.ast.Attribute && node.ctx instanceof $B.ast.Load) {
            insert(begin(node), '__getattr(', node);
            replace(dot(node), end(node), `, ${JSON.stringify(node.attr)})`);
        }

        // A debug field, `{row.name=}`, prints the text of its expression, and
        // that text is about to be rewritten: the label goes ahead as a field
        // of its own, and the `=` becomes the `!r` it stands for when nothing
        // else follows. The parser hands the label over as a constant
        // starting just inside the field's brace and ending past the `=` and
        // the spaces after it, the parentheses around the expression included,
        // `{(row.name)=}`, which the expression's own node leaves out. Its text
        // is read off the source at those places: the engine keeps a string
        // constant's value escaped for JavaScript, `\'` for `'`.
        if (node instanceof $B.ast.JoinedStr) {
            node.values.forEach((label, at) => {
                const field = node.values[at + 1];

                if (!(label instanceof $B.ast.Constant && field instanceof $B.ast.FormattedValue)) return;
                if (begin(label) !== begin(field) + 1) return;

                const text = def.slice(begin(label), end(label));
                const sign = begin(label) + text.trimEnd().length - 1;

                insert(begin(field), `{${JSON.stringify(text)}}`, field);
                replace(sign, end(label), def[end(label)] === '}' ? '!r' : '');
            });
        }

        for (const key of Object.keys(node)) if (key !== 'parent') visit(node[key], shadowed);
    };

    visit(tree);

    edits.sort((one, other) => other.from - one.from || one.size - other.size);

    return edits.reduce((text, one) => text.slice(0, one.from) + one.text + text.slice(one.to), def);
}

// The Python of a component: `text` is what the author wrote in its script;
// `defs` are the hidden functions the template's pass produced, one per
// template expression, and `lines` and `columns` where in the file the markup
// of each stands. They are joined here rather than by the caller because the
// join carries an invariant, and an invariant living in a comment at each call
// site is one that will be got wrong.
//
// The invariant is the indentation. A `<script>` body sits inside markup and
// every example of a framework indents it one level; in JavaScript that is
// whitespace, in Python it is syntax, and the block raises `IndentationError`,
// pointing, in Brython, at the line *after* the last one, which tells the
// author nothing.
//
// `$B.unindent` is Brython's own, the one it already runs on every `<script
// type="text/python">`, so the two tags behave alike and there is no second
// copy of the rule to keep in agreement. It is private upstream, so the engine
// Bryntime ships exposes it in one token. Its rule is `textwrap.dedent`'s with
// a conservative bail (one non-blank line already at column zero and the source
// comes back untouched), and blank lines are kept, so the line count never
// moves and the source map, the tracebacks and `$B.set_lineno` are unaffected.
//
// It has to happen **before** the defs are appended: those are generated at
// column zero and would trip that bail on every component. Holding that order
// is why this lives here and not at the call sites.
//
// A `.py` gets neither half: a file is not an embedded block, so an indented
// one is a mistake rather than a convenience, and a module has no template to
// collect from.
//
// `ranges` says where each template function lands in the Python source, as
// `[from, to, line, column]`, with the file line and column of the markup it
// stands for: an error raised inside one, or inside a lambda it made, is
// reported there rather than at a line of the script that happens to share its
// number. `templateLine` is where the first one starts.
function componentSource(text, defs, lines = [], columns = []) {
    const body = engine().unindent(text);
    const rewritten = defs.map(templateDots);
    const ranges = [];
    let templateLine;
    let from = body.split('\n').length + 1;

    if (rewritten.length) templateLine = from;

    rewritten.forEach((def, index) => {
        const to = from + def.split('\n').length - 1;

        if (lines[index] !== undefined) ranges.push([from, to, lines[index], columns[index]]);

        from = to + 2;
    });

    return { src: rewritten.length ? `${body}\n${rewritten.join('\n\n')}\n` : body, ranges, templateLine };
}

export { EXPR_PREFIX, templateDots, componentSource };
