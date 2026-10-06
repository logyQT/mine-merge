// Generuje tests/unit/fixtures/save-v1.json — "prawdziwy" zapis z połowy gry,
// wytworzony przez samą grę (save() z app.js), niepisany ręcznie.
// Uruchomienie: npm run fixture:gen  (NIE uruchamiaj bez potrzeby — fixture jest zamrożony)
import { writeFileSync } from 'node:fs';
import { createGame } from '../tests/helpers/game.js';

const g = createGame();

// Środek gry: konto lvl 5 (xp 780), 12 wiertliczanych wierszy w głębi, skiny, wojna.
g.api.set({
  coins: 4820,
  spawnLvl: 4, spawnCost: 64, upCost: 320,
  incLvl: 2, incCost: 150,
  renLvl: 1, renCost: 100,
  grid: [4, 0, 0, 3, 0,
         0, 5, 0, 0, 0,
         2, 0, 0, 0, 4,
         0, 0, 3, 0, 0,
         0, 0, 0, 0, 0],
  inv: { 2: 2, 3: 1, 6: 1 },
  blastLvl: 1, blastCost: 160, bombs: 2, bombCost: 500,
  war: { wave: 3, fire: 1, slow: 0, weak: 0 },
  acc: { xp: 780, crates: 1, s: { pow: 2, gain: 1, luck: 1, hp: 1 } },
  econ: { pas: 1, dis: 1 },
  skins: {
    items: [
      { id: 1, theme: 'crypto', rar: 1, perks: [{ t: 'pow', q: 0 }] },
      { id: 2, theme: 'planet', rar: 0, perks: [{ t: 'luck', q: 0 }] }
    ],
    cur: 2,
    nid: 3
  },
  bestDepth: 24
});

// Wiersze generuje prawdziwe makeRow() (wzór HP zależy od accLvl — acc ustawione wyżej).
// 13 wierszy = topRow + 1: renderMine podgląda wiersz za widocznym, więc zapis z
// prawdziwej rozgrywki ma "zapas" jeden wiersz ponad topRow. normalize() go obcina
// przy wczytaniu — to zachowanie pinujemy testem, nie usuwamy.
const rows = g.api.makeRows(13);
g.api.set({ rows, topRow: 12 });

const fixture = g.api.save();
writeFileSync(
  new URL('../tests/unit/fixtures/save-v1.json', import.meta.url),
  JSON.stringify(fixture, null, 2) + '\n'
);
console.log(`save-v1.json: ${JSON.stringify(fixture).length} B, rows=${fixture.rows.length}, topRow=${fixture.topRow}`);
g.dom.window.close();
