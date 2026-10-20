# Bryc

Bryc, the Brython compiler for JavaScript frameworks.

```sh
npm install brycomp
```

```js
import { compile } from 'brycomp';

const { module, map } = compile(host, text, { name, source });
```

`host` is what only the framework knows, member by member in `src/bryc.js`.
Bryc runs on Bryvend, Brython with its fixes. BSD-3-Clause, as Brython.
