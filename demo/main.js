// A page with no framework: the Python typed on the left is compiled by Bryc,
// in the page, for a host written here, and what `compile()` hands back is
// shown on the right. Served as it is, from the repository's root
// (`python3 -m http.server`), at /demo/.
import { compile } from 'bryc';

// What only a framework knows, the least `compile()` asks: the name refusals
// are said under, the module the generated code imports its runtime from, and
// the names it reaches that runtime by.
const host = {
    name: 'demo',
    bridge: 'demo/runtime',
    runtime: { withNamespace: 'withNamespace', pyError: 'pyError' },
    instead: {},
    pathOption: 'path'
};

const EXAMPLES = {
    'Classes and comprehensions': [
        'class Counter:',
        '    def __init__(self, start=0):',
        '        self.count = start',
        '',
        '    def bump(self, by=1):',
        '        self.count += by',
        '        return self.count',
        '',
        '',
        'counter = Counter(10)',
        'total = sum(counter.bump(n) for n in range(3))',
        'label = f"{total} after {counter.count}"',
        ''
    ],
    'Closures and generators': [
        'def counter(start=0):',
        '    count = start',
        '',
        '    def bump(by=1):',
        '        nonlocal count',
        '        count += by',
        '        return count',
        '',
        '    return bump',
        '',
        '',
        'def squares(limit):',
        '    for n in range(limit):',
        '        yield n * n',
        '',
        '',
        'bump = counter(10)',
        'values = [bump(), bump(5), *squares(4)]',
        ''
    ],
    'Pattern matching': [
        'def describe(point):',
        '    match point:',
        '        case (0, 0):',
        '            return "the origin"',
        '        case (x, 0):',
        '            return f"on the x axis at {x}"',
        '        case (0, y):',
        '            return f"on the y axis at {y}"',
        '        case (x, y):',
        '            return f"at {x}, {y}"',
        '',
        '',
        'labels = [describe(p) for p in [(0, 0), (3, 0), (1, 2)]]',
        ''
    ],
    'A name from JavaScript': [
        '# `max` is a function of the JavaScript beside this module, not the builtin.',
        '__js__ = {"./stats.js": ["max"]}',
        '',
        'biggest = max([3, 7, 5])',
        ''
    ],
    'A refusal, at its line': ['total = 1 + 2', '', 'from . import helpers', '', 'result = helpers.double(total)', '']
};

// The Python line each generated line maps to, zero-based, or null: the first
// segment of each line of a version 3 source map, decoded from its base64 VLQ.
const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function originalLines(mappings) {
    let line = 0;

    return mappings.split(';').map((group) => {
        let first = null;

        for (const segment of group.split(',').filter(Boolean)) {
            const values = [];
            let shift = 0;
            let value = 0;

            for (const char of segment) {
                const digit = BASE64.indexOf(char);

                value += (digit & 31) << shift;
                if (digit & 32) {
                    shift += 5;
                } else {
                    values.push(value & 1 ? -(value >>> 1) : value >>> 1);
                    value = 0;
                    shift = 0;
                }
            }

            if (values.length >= 4) {
                line += values[2];
                if (first === null) first = line;
            }
        }

        return first;
    });
}

const $ = (id) => document.getElementById(id);
const escape = (text) => text.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
const paint = (parts) => parts.map(({ cls, text }) => (cls ? `<span class="${cls}">${escape(text)}</span>` : escape(text))).join('');

// No highlighting library. The engine Bryc runs on carries CPython's own
// tokenizer, so the Python is coloured by Python's own rules and cannot drift
// from the grammar. The tokens carry lines and columns, so the source is sliced
// between them and every space survives as written.
const NAME = 1;
const NUMBER = 2;
const STRING = 3;
const FSTRING = [59, 60, 61];
const COMMENT = 65;
const SKIP = [0, 68];

const KEYWORDS = new Set(
    `False None True and as assert async await break class continue def del elif else except finally for from global
     if import in is lambda nonlocal not or pass raise return try while with yield match case`.split(/\s+/)
);
const BUILTINS = new Set('len range str int float list dict set tuple sorted sum min max print isinstance super'.split(' '));

function python(code) {
    const starts = [];
    let offset = 0;
    for (const line of code.split('\n')) {
        starts.push(offset);
        offset += line.length + 1;
    }

    const parts = [];
    let cursor = 0;
    let previous = null;
    let fstring = 0;

    try {
        for (const token of globalThis.__BRYTHON__.tokenizer(`${code}\n`, '<demo>', 'file')) {
            if (SKIP.includes(token.type)) continue;

            const from = starts[token.lineno - 1] + token.col_offset;
            const to = Math.min(starts[token.end_lineno - 1] + token.end_col_offset, code.length);
            if (from >= code.length) break;
            if (from < cursor) continue;

            if (from > cursor) parts.push({ cls: fstring ? 'str' : null, text: code.slice(cursor, from) });

            const cls =
                token.type === COMMENT
                    ? 'com'
                    : token.type === STRING || FSTRING.includes(token.type)
                      ? 'str'
                      : token.type === NUMBER
                        ? 'num'
                        : token.type !== NAME
                          ? null
                          : KEYWORDS.has(token.string)
                            ? 'kw'
                            : previous?.string === 'def' || previous?.string === 'class'
                              ? 'fn'
                              : BUILTINS.has(token.string)
                                ? 'bi'
                                : null;

            parts.push({ cls, text: code.slice(from, to) });

            if (token.type === FSTRING[0]) fstring++;
            else if (token.type === FSTRING[2]) fstring--;

            cursor = to;
            if (token.string.trim()) previous = token;
        }
    } catch {
        // A source being typed may not tokenize: it is shown as written.
        return [{ cls: null, text: code }];
    }

    if (cursor < code.length) parts.push({ cls: null, text: code.slice(cursor) });
    return parts;
}

// The JavaScript, a line at a time: comments, strings, numbers, its keywords,
// and what it reaches of the engine, `$B` and `_b_`.
const JS = /(\/\/.*$|\/\*.*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)/g;
const JS_KEYWORDS = new Set(
    `import export from const let var function return new class extends default as await async if else for while of in
     try catch throw finally typeof instanceof this null undefined true false yield break continue switch case delete void`.split(/\s+/)
);

function javascript(line) {
    const parts = [];
    let cursor = 0;

    for (const match of line.matchAll(JS)) {
        if (match.index > cursor) parts.push({ cls: null, text: line.slice(cursor, match.index) });

        const [text, comment, string, number, name] = match;
        const cls = comment ? 'com' : string ? 'str' : number ? 'num' : JS_KEYWORDS.has(name) ? 'kw' : name === '$B' || name === '_b_' ? 'eng' : null;

        parts.push({ cls, text });
        cursor = match.index + text.length;
    }

    if (cursor < line.length) parts.push({ cls: null, text: line.slice(cursor) });
    return parts;
}

// The Python's own line numbers, which the module's gutter points to, and its
// colours, laid under the text being typed. A trailing line keeps the two the
// same height when the text ends on a newline.
function number() {
    const code = $('source').value;

    $('numbers').textContent = Array.from({ length: code.split('\n').length }, (_, at) => at + 1).join('\n');
    $('highlight').innerHTML = `${paint(python(code))}\n `;
    scroll();
}

function scroll() {
    $('numbers').scrollTop = $('source').scrollTop;
    $('highlight').scrollTop = $('source').scrollTop;
    $('highlight').scrollLeft = $('source').scrollLeft;
}

// The same source compiled twice by each, Brython's own `py2js` and Bryc's
// `compile()`: what each hands back, or what it raised.
const $B = globalThis.__BRYTHON__;
const said = (error) => (error instanceof Error ? error.message : `${$B.class_name(error)}: ${$B.builtins.str.$factory(error)}`);

const attempt = (run) => {
    try {
        return run();
    } catch (error) {
        return { error: said(error) };
    }
};

const brython = (text) => attempt(() => ({ js: $B.py2js({ src: text, filename: 'demo.py' }, 'demo', ['demo']).to_js() }));
const bryc = (text) => attempt(() => compile(host, text, { name: 'demo', source: 'demo.py', sourceContent: text }));

let view = 'bryc';
let last;

const SAYS = {
    bryc: 'What <code>compile()</code> hands the framework, each line with the Python line its source map points to.',
    brython: "What Brython's own <code>py2js</code> writes for the same source: a script, with no line of Python to point to."
};

function render() {
    const { plain, ours } = last;
    const shown = view === 'bryc' ? ours : plain;

    $('view-says').innerHTML = SAYS[view];
    $('view-bryc').setAttribute('aria-pressed', String(view === 'bryc'));
    $('view-brython').setAttribute('aria-pressed', String(view === 'brython'));

    if (shown.error) {
        // What the author reads, in place of the module the code did not make.
        $('module').innerHTML = `<span class="refusal">${escape(shown.error)}</span>`;
        return;
    }

    if (view === 'brython') {
        $('module').innerHTML = shown.js.split('\n').map((line) => paint(javascript(line))).join('\n');
        return;
    }

    const python = originalLines(shown.map.mappings);
    const width = String(Math.max(1, ...python.filter((one) => one !== null).map((one) => one + 1))).length;

    $('module').innerHTML = shown.module
        .split('\n')
        .map((line, at) => {
            const from = python[at];
            const gutter = from === null ? ' '.repeat(width + 3) : `py ${String(from + 1).padStart(width)}`;

            return `<span class="gutter${from === null ? '' : ' mapped'}">${gutter}</span>  ${paint(javascript(line))}`;
        })
        .join('\n');
}

// What Bryc adds, each row measured on the source as typed.
function adds(text, plain, ours) {
    const again = { plain: brython(text), ours: bryc(text) };
    const same = (one, two) => !one.error && !two.error && (one.module ?? one.js) === (two.module ?? two.js);
    const cell = (good, html) => `<td class="${good ? 'gain' : 'loss'}">${html}</td>`;
    const rows = [];

    rows.push([
        'Compiled twice',
        plain.error ? '<td>–</td>' : cell(same(plain, again.plain), same(plain, again.plain) ? 'the same text' : 'two different texts: functions and lambdas are numbered by a counter of the page'),
        ours.error ? '<td>–</td>' : cell(same(ours, again.ours), same(ours, again.ours) ? 'the same text, its numbers drawn from the file' : 'two different texts')
    ]);

    rows.push([
        'What it makes',
        plain.error ? '<td>–</td>' : cell(false, 'a script writing to the page\'s own namespace, <code>$B.namespace("demo_py")</code>'),
        ours.error ? '<td>–</td>' : cell(true, 'an ES module, <code>export function init(ns)</code>: the framework hands the namespace in, its names held as it holds state')
    ]);

    const mapped = ours.error ? 0 : originalLines(ours.map.mappings).filter((one) => one !== null).length;
    rows.push([
        'Source map',
        cell(false, 'none'),
        ours.error ? '<td>–</td>' : cell(true, `${mapped} of ${ours.module.split('\n').length} lines tied to their Python line`)
    ]);

    // What the page cannot run, an import of nothing or a module that does not
    // ship: Brython does not look for it, and Bryc does, at build time.
    rows.push([
        'What the page could not run',
        plain.error
            ? cell(false, `stops at Python's own error: ${escape(plain.error)}`)
            : ours.error
              ? cell(false, 'not looked for: it compiles, and fails only when the page runs it')
              : cell(false, 'not looked for'),
        ours.error ? cell(true, `refused at build, at its line: ${escape(ours.error)}`) : cell(true, 'looked for at build: nothing here')
    ]);

    // A function of the JavaScript beside the module, named like a Python
    // builtin: Brython takes it for the builtin.
    const named = ours.error ? [] : ours.jsImported.filter((one) => one in $B.builtins);
    rows.push([
        'A JavaScript function named like a builtin',
        ...(named.length
            ? [
                  cell(false, named.map((one) => `<code>${one}(…)</code> calls Python's builtin, <code>_b_.${one}</code>, not the JavaScript function`).join('<br>')),
                  cell(true, named.map((one) => `<code>${one}(…)</code> calls the JavaScript function, read off the module's namespace`).join('<br>'))
              ]
            : ['<td colspan="2" class="ok">none in this code: the example “A name from JavaScript” imports a JavaScript <code>max</code></td>'])
    ]);

    $('adds').innerHTML = rows.map(([name, ...cells]) => `<tr><th>${name}</th>${cells.join('')}</tr>`).join('');
}

function show() {
    const text = $('source').value;

    number();

    const plain = brython(text);
    const ours = bryc(text);

    last = { plain, ours };
    render();
    adds(text, plain, ours);

    $('namespace').textContent = ours.error ? '–' : ours.namespace;
    $('lines').textContent = ours.error ? '–' : `${text.split('\n').length} of Python, ${ours.module.split('\n').length} of JavaScript`;
    $('refusal').textContent = ours.error ?? 'none';
    $('refusal').className = ours.error ? 'refusal' : 'ok';
}

$('view-bryc').addEventListener('click', () => {
    view = 'bryc';
    render();
});
$('view-brython').addEventListener('click', () => {
    view = 'brython';
    render();
});

function choose(name) {
    $('source').value = EXAMPLES[name].join('\n');
    for (const button of $('examples').children) button.setAttribute('aria-pressed', String(button.textContent === name));
    show();
}

for (const name of Object.keys(EXAMPLES)) {
    const button = document.createElement('button');

    button.type = 'button';
    button.textContent = name;
    button.addEventListener('click', () => choose(name));
    $('examples').append(button);
}

let pending;
$('source').addEventListener('input', () => {
    number();
    clearTimeout(pending);
    pending = setTimeout(show, 200);
});
$('source').addEventListener('scroll', scroll);

choose(Object.keys(EXAMPLES)[0]);
