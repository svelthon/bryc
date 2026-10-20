# What Bryc asks of Brython

Bryc compiles Python to JavaScript with Brython's compiler, the parsing chain
Bryvend ships beside the engine, which its door loads. Almost none of what it
touches is a public API: it is the shape of Brython's internals. This file is
the contract, so that a Brython change can be checked against it, and so that
whoever reads `src/` knows which assumptions are load-bearing.

Verified against the engine Bryvend ships, `$B.version_info == [3, 14, 0]`.

## The single point everything rests on

```js
locals_Counter = $B.namespace('Counter')
locals_Counter.count = 0
```

Brython keeps a module's state in a **namespace object**, never in lexical
bindings, since Python semantics require it, for `globals()`, `exec`, and
dynamic name resolution. A host's runtime replaces that object, for the
duration of the module body, with one whose every property is an accessor onto
one of the framework's states, and every assignment the code generator already
emits becomes a reactive write.

**If this shape changed, no host would work at all.** It is the only assumption
checked at compile time: `moduleNamespace` refuses the code when the expected
call is absent, rather than hand a host a module with no reactivity.

## Internals used

| | |
|---|---|
| `$B.py2js(src, module, locals_id, parent)` | returns `{ _ast, imports, to_js() }`. A name nothing in the module binds and `$B.builtins` holds compiles to the builtin itself, `_b_.max`; a name the module binds, even in a branch that never runs, is read at run time, the module's namespace first. That is how a JavaScript import spelled like a builtin is read as the import: `translation` compiles again with `if False:` binding those names |
| `$B.js_from_root({ ast, symtable, filename, src })` | the code generator `py2js` ends with, given a tree: `declaredExports` hands it a module of one statement of `__all__` at a time, from a parse of its own, and runs what comes back, so the export list is what Python computes. The namespace is the one `$B.namespace(filename)` hands back, swapped for one of its own while those statements run |
| `new $B.ast.Module(body, type_ignores)` | that one-statement module |
| `$B.is_list(value)`, `$B.is_tuple(value)` | whether what `__all__` holds once those statements have run is an export list |
| `$B.ast.*` | AST classes, compared with `instanceof` |
| `new $B.Parser(src, filename, mode)` | how `templateDots` parses one template function, `declaredExports` one statement, and a binding's target is parsed in `'eval'` mode |
| `$B._PyPegen.run_parser(parser)` | returns the AST of what `parser` holds, with `lineno`, `col_offset`, `end_lineno` and `end_col_offset` counted in characters; `templateDots` rewrites the dots of the markup at those places |
| `$B.unindent(src)` | Brython's own, the one it already runs on every `<script type="text/python">`; it hands the source back untouched as soon as one non-blank line starts at column zero |
| `$B.file_cache[filename]` | where `compiler_error` looks for the source to quote. Filling it is what turns a bare message into a message with the offending line under it |
| `$B.get_class(error)`, `$B.class_name(error)`, `$B.$getattr`, `$B.builtins.str.$factory` | how a Python error raised while compiling is described: its class's `__name__`, its message and its `lineno` |
| `$B._PySymtable_Build(ast, filename, $B.future_features(ast, filename))` | Python's symbol table for a module, the analysis CPython's `symtable` gives: the module's block, each with `symbols` and `children`. `globalReads` asks it which names some block **reads as a global**, so a parameter or a local of a host's word is not taken for the module's |
| `$B.SYMBOL_FLAGS` | the flags of a symbol: `USE`, `DEF_BOUND`, and the scope held at `SCOPE_OFFSET` under `SCOPE_MASK`, `GLOBAL_IMPLICIT` and `GLOBAL_EXPLICIT` among them. `moduleBinds` reads the module's bound names off it, and the check of `__all__` where each write of it resolves |
| `$B.str_dict_get(symbols, name, 0)` | a symbol's flags, `0` when the block does not know the name; a block's symbols are walked with `$B.builtins.dict.$iter_items` |
| `node[$B.ID]` | the id Brython writes on an AST node as it builds the symbol table, which is the `id` of the block that node opens: how a `def`, a `class`, a lambda or a comprehension finds its block |
| `$B.id_counter(n)` | sets the counter the code generator numbers functions with and returns its previous value; carried as a commit proposed upstream, since the counter is private there. Bryc draws it from the file's path so one source compiles to one text, and gives it back after |
| `$B.lambda_magic` | the tag in every generated lambda's name, drawn at random per process; set and given back beside the counter |
| `$B.url2name[filename]` | the module name Brython's importer gives a file, which the code generator writes as the module's `__name__` and the `__module__` of what it defines; set for a module to its import name while it compiles, and given back after |
| `$B.stdlib` | Brython's catalogue of the modules it can import: `from browser import timer` imports the submodule `browser.timer` when the catalogue names one, and `help("name")` documents a name it holds no module of |
| `$B.set_lineno(frame, N)` | emitted throughout the generated code, which therefore carries the Python line it came from: enough for a line-level source map |
| `$B.resolve_global(name, ns)` | where a global the generated code reads is resolved, through `resolve_in_namespace`, which demands an *own* property unless the namespace says `$proxy`: the member whose disappearance would stop the whole namespace trick, and the one nobody would think to grep for |

`py2js` derives the namespace identifier from **`filename`**, or from the name
`$B.url2name` gives it: `module` and `locals_id` are ignored by `js_from_root`.
