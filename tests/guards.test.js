// @vitest-environment node
//
// **Bryc holds nothing of the framework it serves**: its files reach one
// another and Bryve, nothing else, Bryntime included; its code names neither
// a framework nor a rune nor a bridge; and what it says of itself names no
// tool built on it. Its tests reach it by its door, `src/bryc.js`, the one
// module its package exports.
import { test, expect, describe } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const SRC = 'src';
const DOOR = `${SRC}/bryc.js`;
const files = (dir) => readdirSync(dir).filter((file) => file.endsWith('.js')).map((file) => join(dir, file));

const lines = (file) =>
    readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => [`${file}:${index + 1}`, line]);

// The code of a file, its comments blanked, line for line.
const code = (file) =>
    readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ''))
        .split('\n')
        .map((line, index) => [`${file}:${index + 1}`, line.replace(/(^|\s)\/\/.*$/, '')]);

// A statement that imports, not a string that reads like one: `import … from`,
// `export … from` and the `} from` that ends one written over several lines, a
// bare `import`, a `require(` and an `import(`.
const IMPORTED = /(?:^\s*(?:import|export)\b[^'"]*?\bfrom\s+|^\s*\}\s*from\s+|^\s*import\s+|\brequire\(\s*|\bimport\(\s*)['"]([^'"]+)['"]/g;

const imports = (file) => code(file).flatMap(([where, line]) => [...line.matchAll(IMPORTED)].map(([, to]) => [where, to]));

test('Bryc reaches no file outside its folder', () => {
    const reached = files(SRC).flatMap((file) =>
        imports(file)
            .filter(([, to]) => to.startsWith('.') && (!to.startsWith('./') || to.includes('/../')))
            .map(([where, to]) => `${where}: ${to}`)
    );

    expect(reached).toEqual([]);
});

// Of the packages, Bryve alone, the engine started and then its parsing chain:
// Bryc runs on Brython, never on a host's runtime, Bryntime included.
test('Bryc imports no package but Bryve, Bryntime none', () => {
    const packages = files(SRC).flatMap((file) => imports(file).filter(([, to]) => !to.startsWith('.')));

    expect(packages.filter(([, to]) => /^bryntime\b/.test(to))).toEqual([]);
    expect(packages.map(([, to]) => to)).toEqual(['bryve', 'bryve/compiler']);
});

// The tests reach Bryc by its door and by nothing else: no fixture, no other
// package, a host of their own written in the test. `vitest` is what runs them,
// and this file, which reads the others, takes Node's own modules to do it.
test("Bryc's tests import its door and nothing else", () => {
    const tests = files('tests');
    const imported = tests.flatMap((file) =>
        imports(file)
            .filter(([, to]) => to !== 'vitest' && resolve(dirname(file), to) !== resolve(DOOR))
            .filter(([, to]) => !(file.endsWith('guards.test.js') && to.startsWith('node:')))
            .map(([where, to]) => `${where}: ${to}`)
    );

    expect(tests.length).toBeGreaterThan(1);
    expect(readdirSync('tests').filter((file) => !file.endsWith('.test.js'))).toEqual([]);
    expect(imported).toEqual([]);
});

// A dependency names none of its dependents, in its code or in what it says of
// itself: a comment may take a framework for its example, never a tool built on
// Bryc.
test('Bryc names no tool built on it, comments included', () => {
    const named = files(SRC).flatMap((file) =>
        lines(file)
            .filter(([, line]) => /svelthon|vuython/i.test(line))
            .map(([where, line]) => `${where}: ${line.trim()}`)
    );

    expect(named).toEqual([]);
});

// **`BRYTHON.md` names every member of the engine Bryc reaches for**: almost
// none is public API, so the file is the contract a Brython release is checked
// against, and a contract that misses one is trusted all the same. Read off the
// files, comments included, so a new member cannot arrive unnoticed.
describe('BRYTHON.md names every member Bryc reaches for', () => {
    const contract = readFileSync('BRYTHON.md', 'utf8');
    const used = new Set(
        files(SRC).flatMap((file) =>
            [...readFileSync(file, 'utf8').matchAll(/(?:\$B|__BRYTHON__)\.([A-Za-z_$][A-Za-z0-9_$]*)/g)].map(([, member]) => member)
        )
    );

    // Measured when Bryc left its first host: 25. A pattern that stopped
    // matching would otherwise pass by finding nothing.
    test('there are members to check at all', () => {
        expect(used.size).toBeGreaterThanOrEqual(25);
    });

    test.for([...used].sort().map((member) => [member]))('%s', ([member]) => {
        expect(contract).toContain(member);
    });
});

test('the code of Bryc names no framework, no rune and no bridge', () => {
    const named = files(SRC).flatMap((file) =>
        code(file)
            .filter(([, line]) => /svelte|svelthon|__pybridge|\$(?:state|derived|effect|props|bindable|inspect|host)\b/i.test(line))
            .map(([where, line]) => `${where}: ${line.trim()}`)
    );

    expect(files(SRC).length).toBeGreaterThan(0);
    expect(named).toEqual([]);
});
