# Bryc

Bryc, the glue between Brython and a JavaScript framework, run at build time.

```sh
npm install bryc
```

```js
import { compile } from 'bryc';

const { module, map } = compile(host, text, { name, source });
```

`host` is what only the framework knows, member by member in `src/bryc.js`.
Bryc runs on Bryve, Brython with its fixes. BSD-3-Clause, as Brython.
