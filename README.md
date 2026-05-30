# ruflo-ia32

**Ruflo multi-agent swarm — pure JavaScript port for iSH (iPhone)**

Clone של [ruvnet/ruflo](https://github.com/ruvnet/ruflo) שנכתב מחדש כ-CommonJS נקי.
עובד על Node 14 + ia32 (iSH) — ללא native binaries, ללא Rust, ללא TypeScript.

---

## התקנה ב-iSH

```sh
# העתק את הפרויקט
cd ~
# (העלה את ruflo-ia32.zip ל-iSH או clone מ-GitHub)
unzip ruflo-ia32.zip
cd ruflo-ia32

# אין צורך ב-npm install — אפס תלויות חיצוניות
node bin/ruflo.js help
```

---

## שימוש

### אתחול פרויקט
```sh
cd ~/my-project
node ~/ruflo-ia32/bin/ruflo.js init
```

### REPL אינטראקטיבי
```sh
node bin/ruflo.js
```
```
ruflo> agent spawn coder
ruflo> agent spawn tester
ruflo> agent list
ruflo> task run code
ruflo> swarm state
ruflo> help
```

### פקודות CLI
```sh
node bin/ruflo.js agent spawn coder
node bin/ruflo.js agent spawn security
node bin/ruflo.js agent list
node bin/ruflo.js swarm state
node bin/ruflo.js swarm scale coder 3
node bin/ruflo.js task run code '{"input":"fix bug"}'
node bin/ruflo.js peer listen 7700
node bin/ruflo.js peer connect 192.168.1.5 7700
node bin/ruflo.js memory list
node bin/ruflo.js memory clear
```

### שימוש כ-library
```js
var ruflo = require('./src/index');

var memory = new ruflo.MemoryBackend({ persist: true });
var swarm  = new ruflo.SwarmCoordinator({
  topology: 'hierarchical',
  memoryBackend: memory
});

await swarm.initialize();
await swarm.spawnAgent({ id: 'queen', type: 'coordinator', role: 'leader' });
await swarm.spawnAgent({ type: 'coder' });
await swarm.spawnAgent({ type: 'security' });

var results = await swarm.executeTasksConcurrently([
  { id: 't1', type: 'code',   priority: 'high' },
  { id: 't2', type: 'review', priority: 'medium' },
]);
console.log(results);
```

---

## ארכיטקטורה

```
src/
  agent.js       — Agent entity (כולל capabilities, executeTask)
  task.js        — Task entity (priority sort, dependency resolution)
  memory.js      — MemoryBackend in-memory + JSON file persistence
  swarm.js       — SwarmCoordinator (hierarchical / mesh / pipeline)
  federation.js  — FederationPeer (TCP transport + safety gate)
  index.js       — public API

bin/
  ruflo.js       — CLI + REPL
```

### Safety Gate (federation)
בדיוק כמו ה-Rust crate המקורי — 3 שכבות:
1. **Block** — מנגנון API keys, secrets, tokens
2. **Redact** — החלפת IP / email ב-[IP] / [EMAIL]
3. **Pass** — הודעה נקייה עוברת

### טופולוגיות
| טופולוגיה | תיאור |
|-----------|--------|
| `hierarchical` | Queen + Workers |
| `mesh` | כל agent מחובר לכולם |
| `pipeline` | שרשרת סדרתית |

---

## הרצת בדיקות
```sh
node tests/test.js
# 13 tests — 13 passed, 0 failed
```

---

## ההבדלים מ-Ruflo המקורי

| תכונה | Ruflo המקורי | ruflo-ia32 |
|--------|-------------|------------|
| שפה | TypeScript + Rust | JavaScript בלבד |
| Node | >=20, x64/arm64 | >=14, כולל ia32 |
| Transport | QUIC (midstreamer) | TCP (net module) |
| Memory | SQLite + AgentDB | JSON file / in-memory |
| LLM | Claude Code integration | stub (להחליף בAPI call) |
| Native deps | כן | אפס |

---

MIT License
