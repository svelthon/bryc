// What a Python error at compile time becomes: a refusal that names the file,
// the line and, for a template expression, what Python writes instead. Said
// under the name of the host that compiles (`host.name`), which is the tool
// the author ran.
import { replaceLiterals } from './expressions.js';

// A Brython exception carries neither `message` nor `stack`, so a Python syntax
// error would reach Vite as an empty object and be reported as nothing at all.
// `$B.unindent` hands the source back untouched as soon as one non-blank line
// already sits at column zero: it reads that as an author who meant it. In a
// `.svelte` the block is indented one level by convention, so such a line is
// almost always one typed without the others' indentation, and nothing is
// dedented, so Brython raises on the *first* line instead, which the author did
// not touch.
//
// Refusing is right: a line out of line with its neighbours is a mistake, and
// compiling it anyway would accept in silence what the rest of the project
// rejects out loud. Returns the line to blame, or 0 when there is nothing to
// say.
function flushLine(src) {
    const lines = src.split('\n');
    if (!lines.some((line) => /^[ \t]+\S/.test(line))) return 0;

    return lines.findIndex((line) => /^\S/.test(line)) + 1;
}

// A refusal, in Svelte's own error shape, which is what makes it clickable.
//
// `vite-plugin-svelte` builds `rollupError.loc` only `if (error.start)`, and
// `loc` is what the dev overlay highlights and what an editor jumps to. Without
// it, a mistake in the markup got a squiggle and a mistake in the script got a
// line of console text, out of the same compiler.
//
// The position stays in the message as well, and that is not a duplicate: the
// fields are what the plugin reads, the sentence is what anyone else reads, a
// compile in a browser included.
//
// There is no column. These refusals know which line they were reading and not
// where in it; the template's pass has one because it scans character by
// character.
function positioned(error, source, line, column = 0) {
    error.filename = source;

    if (typeof line === 'number') {
        error.start = { line, column };
        error.end = { line, column };
    }

    return error;
}

const refuse = (message, source, line, column) =>
    positioned(new SyntaxError(message), source, line, column);

// JavaScript an author coming from Svelte writes in a template that reads
// Python, and what Python writes instead. Read on the expression with its
// strings taken out, so a `?` or a `!` inside a string says nothing.
const HABITS = [
    [/\?[^:]*:/, '`a ? b : c` is `b if a else c`'],
    [/&&|\|\|/, '`&&` and `||` are `and` and `or`'],
    [/[!=]==/, '`===` and `!==` are `==` and `!=`'],
    // Not `!r`, `!s`, `!a`: a conversion, which belongs in an f-string field.
    [/(^|[^!=<>])!(?![=rsa]\b)/, '`!x` is `not x`'],
    [/`/, 'a template literal is an f-string, `f"n={x}"`'],
    [/=>/, 'an arrow function is a `lambda`: `lambda: (count := count + 1)`'],
    [/\+\+|--/, '`x++` is `(x := x + 1)`'],
    [/\?\?/, '`a ?? b` is `a if a is not None else b`'],
    [/\b(?:null|undefined|true|false)\b/, '`null`, `true`, `false` are `None`, `True`, `False`'],
    [/\.push\(/, '`.push(x)` is `.append(x)`'],
    [/\.length\b/, '`.length` is `len(…)`']
];

// A comment goes, a string becomes `""`, and a backquoted text stays: it is no
// Python string, and it is one of the habits.
const habitsIn = (text) => {
    const code = replaceLiterals(text, (literal) =>
        literal[0] === '#' ? '' : literal[0] === '`' ? literal : '""'
    );
    return HABITS.filter(([pattern]) => pattern.test(code)).map(([, said]) => said);
};

// `lineOffset` is the count of lines before the script, and `ranges` the Python
// lines each template function occupies with the markup line it stands for: the
// table the runtime reads for an error raised later, read here for one raised
// at compile time. A syntax error in `{ok ? "yes" : "no"}` names the line of
// markup it is written on, quotes it, and says what Python writes instead.
function pythonError(host, error, source, lineOffset, block = '', ranges = [], src = '') {
    const $B = globalThis.__BRYTHON__;

    // A JavaScript Error is Brython failing in its own code rather than raising
    // a Python exception, a stack overflowed by deeply nested brackets. Its
    // message is kept as it is, since Python's formatting would read it as
    // `JSObject: <Javascript object: [object Error]>`, and the file is said.
    if (error instanceof Error) {
        const wrapped = positioned(
            new SyntaxError(`${host.name} — Brython could not compile this file: ${error.name}: ${error.message} (${source})`),
            source
        );

        wrapped.cause = error;

        return wrapped;
    }

    let described = 'PythonError';
    let where = source;
    let at;
    let column;

    try {
        const name = $B.$getattr($B.get_class(error), '__name__');
        described = `${name}: ${$B.builtins.str.$factory(error)}`;
    } catch {
        /* not a Brython exception: keep the generic label */
    }

    let quoted = '';

    try {
        const line = $B.$getattr(error, 'lineno');
        if (typeof line === 'number') {
            const range = ranges.find(([from, to]) => line >= from && line <= to);
            at = range === undefined ? line + lineOffset : range[2];
            // The column of the expression itself when it is one of the
            // template's, in the `file:line:column` its refusals use.
            column = range === undefined ? undefined : range[3];
            where = column === undefined ? `${source}:${at}` : `${source}:${at}:${column + 1}`;

            if (range !== undefined) {
                // The author's text, out of the wrapper the template's pass
                // put around it: `__text(…)`, `__truthy(…)`.
                const written = src
                    .split('\n')
                    .slice(range[0], range[1])
                    .join(' ')
                    .trim()
                    .replace(/^return\s+/, '')
                    .replace(/^__\w+\(([\s\S]*)\)$/, '$1');
                const said = habitsIn(written);
                quoted =
                    `\n  in the template expression \`${written}\`,` +
                    ` which is Python` +
                    (said.length ? `: ${said.join('; ')}.` : '.');
            }
        }
    } catch {
        /* no position on it */
    }

    const flush = described.startsWith('IndentationError') ? flushLine(block) : 0;

    return refuse(
        `${host.name} — ${described} (${where})` +
            quoted +
            (flush
                ? `\n  line ${flush + lineOffset} starts at column zero while the rest of` +
                  ` the block is indented, so indent it like its neighbours.`
                : ''),
        source,
        at,
        column
    );
}

export { refuse, pythonError };
