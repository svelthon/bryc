# Brycomp

**The Brython compiler for JavaScript frameworks.**

Brython translates Python to JavaScript. Brycomp is what a JavaScript
framework's compiler needs on top of it to build with that translation: a
module the framework runs, the same text on every build, a source map, the
names JavaScript gives the Python, and everything the page could not run
refused at build time, at its line.

Install it from [npm](https://www.npmjs.com/package/brycomp):

```sh
npm install brycomp
```

```js
import { compile } from 'brycomp';

const { module, map } = compile(host, text, { name: 'cart', source: 'src/cart.py' });
// module: `export function init(ns)`, the Python run in the namespace the framework hands in
// map:    its source map, each line tied to the Python line it came from
```

## What it does

Brython's own `py2js` turns Python into a script for a page. A framework builds
modules, caches them, maps them back to their source and reports its errors at
build time. Brycomp closes each gap:

- **One text per source**: Brython numbers functions with a counter of the page
  and draws the names of lambdas at random, so a file compiled twice gives two
  texts. Brycomp draws both from the file's path: a build is reproducible, and
  a cache or a hot reload sees only what changed.
- **A module** (`compile`): an ES module, `export function init(ns)`, which
  imports its runtime from the framework's bridge under the names the
  framework gives, and runs the Python in the namespace the framework hands
  in, so the module's names can be held as the framework holds its state.
- **A source map**, each generated line tied to the Python line it came from.
- **The names JavaScript gives the module** (`__js__`, `importjs`): read off
  the module's namespace, even spelled like a builtin, where Brython compiles
  `max(…)` as Python's own `max`.
- **Refusals at build time, at their line** (`refuse`): a relative import, a
  module of Python's standard library that does not ship, type parameters, a
  name imported from JavaScript that Python binds, a call that needs what the
  page does not have; and a Python error, its line quoted, at the line and
  column of the markup when it comes from a template.
- **Python's own reading of the source** (`symbolTable`, `declaredExports`,
  `moduleBinds`, `globalReads`): the symbol table, Python's scopes, and the
  export list `__all__` holds once its statements have run, for the framework
  to read what a source declares.

## A framework's side

A framework hands `compile()` a `host`, what only it knows, and receives the
module, its source map, the symbol table and the imports:

```js
const host = {
    name: 'tool', // what every refusal is signed with: `tool — …`
    bridge: 'tool/bridge', // the module the generated code imports its runtime from
    runtime: { withNamespace: 'withNamespace', pyError: 'pyError' }, // the names it reaches that runtime by
    instead: { json: '`from_json(text)` reads JSON' }, // said when a standard module's import is refused
    pathOption: 'path' // the option an author adds a folder of modules to
};
```

A host also says how a name of the module becomes one of its states
(`state`), which of its own words an author may not redefine (`reserved`), and,
optionally, how its own syntax becomes Python before the translation
(`rewrite`). For a component, it hands over the functions its template
compiled to (`defs`), which Brycomp joins after the script, each where its
markup stands; a host whose template reads a key with a dot writes them with
`templateDots` first. Every member is described in `src/bryc.js`, Brycomp's
one door.

## Demo

`demo/` compiles, in the page, the Python typed beside the module Brycomp
makes of it, each line with the Python line its source map points to, and
Brython's own translation of the same source beside it, with a table, measured
on what was typed, of what Brycomp adds.

It is online at <https://svelthon.github.io/brycomp/>, deployed from `main`
once the tests pass. Locally, after `npm install`, it is served as it is, from
the repository's root:

```sh
python3 -m http.server
```

then `http://localhost:8000/demo/`.

## The engine

Brycomp runs on Bryvend, its peer dependency: Brython's master and the
repairs proposed there and not merged yet, as an ES module. Its door loads the
engine started, then its parsing chain, `bryvend/compiler`: a framework loads
nothing for it, and Brycomp needs no runtime of the framework's.

What Brycomp asks of the engine, member by member, is in `BRYTHON.md`.

## License

Brycomp is licensed under the BSD 3-Clause License, the same license as
Brython.
