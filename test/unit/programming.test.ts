// The programming packs: each key mishearing is fixed, and ordinary classroom speech is left alone.
import { describe, expect, it } from 'vitest';
import { WordFixer, parseWordList } from '../../src/wordlist';
import { defaultRules } from '../../src/speak/words';
import progEn from '../../wordlists/programming.en.json';
import progFr from '../../wordlists/programming.fr.json';

// What the teacher gets by default: bash and programming packs together.
const en = new WordFixer(defaultRules('en'));
const fr = new WordFixer(defaultRules('fr'));

describe('programming pack (English)', () => {
  const cases: [string, string][] = [
    ['it returns a bully', 'it returns a boolean'],
    ['a bullion value', 'a boolean value'],
    // "bully and" is deliberately NOT a rule: it would delete a real "and" ("a bully and a string").
    ['this is a bully and so it is true or false', 'this is a boolean and so it is true or false'],
    ['it returns a bully and uses grip', 'it returns a boolean and uses grep'],
    ['the boo lean type', 'the boolean type'],
    ['two boo leans', 'two booleans'],
    ['save it as a Jason file', 'save it as a JSON file'],
    ['send the Jason object', 'send the JSON object'],
    ['the data is in Jason', 'the data is in JSON'],
    ['call Jason dot parse on it', 'call JSON.parse on it'],
    ['use Jason stringify', 'use JSON.stringify'],
    ['write a sync before the function', 'write async before the function'],
    ['an a sink function', 'an async function'],
    ['change the dom', 'change the DOM'],
    ['push it to get hub', 'push it to GitHub'],
    ['open git hub', 'open GitHub'],
    ['install node JS', 'install Node.js'],
    ['run N P M install', 'run npm install'],
    ['NPM start', 'npm start'],
    ['a reg ex for emails', 'a regex for emails'],
    ['learn type script', 'learn TypeScript'],
    ['learn java script today', 'learn JavaScript today'],
    ['call use state with zero', 'call useState with zero'],
    ['the use state hook', 'the useState hook'],
    ['then use effect', 'then useEffect'],
    ['open local host in the browser', 'open localhost in the browser'],
    ['name it in camel case', 'name it in camelCase'],
    ['return a two pull', 'return a tuple'],
    ['review two pull requests', 'review two pull requests'],
    ['write a four loop', 'write a for loop'],
    ['a wild loop runs forever', 'a while loop runs forever'],
    ['type get commit then get push', 'type git commit then git push'],
    ['you get push notifications', 'you get push notifications'],
    ['run get init here', 'run git init here'],
    ['console dot log the result', 'console.log the result'],
    ['the h t m l and c s s files', 'the HTML and CSS files'],
    ['a sequel query', 'a SQL query'],
    ['install my sequel', 'install MySQL'],
    ['the package dot json file', 'the package.json file'],
    ['delete node modules', 'delete node_modules'],
    ['open vs code', 'open VS Code'],
    ['learn python and jango', 'learn Python and Django'],
    ['use flex box', 'use flexbox'],
    ['call the a p i', 'call the API'],
    ['add a dev tag', 'add a div tag'],
    ['the inner HTML property', 'the innerHTML property'],
    ['call query selector', 'call querySelector'],
    ['ask chat GPT', 'ask ChatGPT'],
  ];
  for (const [heard, shown] of cases) it(`"${heard}"`, () => expect(en.apply(heard)).toBe(shown));
});

describe('programming pack (French)', () => {
  const cases: [string, string][] = [
    ['une valeur bully', 'une valeur boolean'],
    ['un type bouléen', 'un type booléen'],
    ['un fichier Jason', 'un fichier JSON'],
    ['les données en Jason', 'les données en JSON'],
    ['on apprend java script', 'on apprend JavaScript'],
    ['une fonction a sync', 'une fonction async'],
    ['modifier le dom', 'modifier le DOM'],
    ['poussez sur guitte hub', 'poussez sur GitHub'],
    ['installez node JS', 'installez Node.js'],
    ['lancez n p m install', 'lancez npm install'],
    ['une reg ex simple', 'une regex simple'],
    ['appelez use state', 'appelez useState'],
    ['ouvrez local host', 'ouvrez localhost'],
    ['écrivez en camel case', 'écrivez en camelCase'],
    ['une boucle fort', 'une boucle for'],
    ['le fichier package point json', 'le fichier package.json'],
    ['console point log', 'console.log'],
    ['le h t m l et le c s s', 'le HTML et le CSS'],
    ['installez my sequel', 'installez MySQL'],
  ];
  for (const [heard, shown] of cases) it(`"${heard}"`, () => expect(fr.apply(heard)).toBe(shown));
});

describe('no false positives', () => {
  // Ordinary classroom speech must pass through untouched with every default pack on.
  const english = [
    'Good morning everyone, please sit down.',
    'Take out your notebooks and a pen.',
    'Get your laptops ready, we start in five minutes.',
    'Can you get the attendance sheet from the office?',
    'I want everyone to get a partner for this exercise.',
    'Please do not push your classmates.',
    'Jason, can you read the next question?',
    'Jason and Mary will present first.',
    'We wait for everyone to arrive before we begin.',
    'There is a sink at the back of the lab.',
    'Please wash your hands in the sink.',
    'The answer is no, try again.',
    'Is anyone in the car park?',
    'The car is outside the building.',
    'Write your name in the top corner.',
    'He rejects the idea, and that is fine.',
    'If the promise rejects, we catch the error.',
    'Draw a red X on the wrong answers.',
    'Pull the door when you leave.',
    'I need two volunteers to pull the table.',
    'We will take a short break at ten.',
    'Look at the dome on the old church.',
    'Use the state of the art tools you have.',
    'The movie had a sequel last year.',
    'Use your local library on weekends.',
    'The function returns true or false.',
    'Write a function that adds two numbers.',
    'Open the file and save your work.',
    'A variable holds a value.',
    'Make sure your code works before you push.',
    'Who can explain what a loop does?',
    'Four students are missing today.',
    'Read me the second paragraph, please.',
    'My phone has push notifications turned off.',
    'Hand in your homework on Friday.',
    'This sentence has no technical words.',
  ];
  const french = [
    'Bonjour à tous, asseyez-vous s’il vous plaît.',
    'Sortez vos cahiers et un stylo.',
    'Nous allons commencer dans cinq minutes.',
    'Jason, peux-tu lire la question suivante ?',
    'Le fichier est dans le dossier du cours.',
    'Il fait chaud aujourd’hui, ouvrez la fenêtre.',
    'Qui peut expliquer ce que fait une boucle ?',
    'Une variable contient une valeur.',
    'La fonction renvoie vrai ou faux.',
    'Écrivez votre nom en haut de la page.',
    'Mettez votre pull, il fait froid dehors.',
    'Nous avons un dôme sur la photo.',
    'Rendez vos devoirs vendredi.',
    'Travaillez avec votre voisin.',
    'Le cours de demain commence à huit heures.',
    'Lisez le deuxième paragraphe à voix haute.',
    'Il a raison, c’est la bonne réponse.',
    'Enregistrez votre travail avant de partir.',
    'On fait une pause de dix minutes.',
    'Le gîte est loin de la ville.',
    'Est-ce que tout le monde a compris ?',
    'Cette phrase ne contient aucun mot technique.',
  ];
  for (const s of english) it(`EN: ${s}`, () => expect(en.apply(s)).toBe(s));
  for (const s of french) it(`FR: ${s}`, () => expect(fr.apply(s)).toBe(s));
  it('known trade-off: "bully" always becomes boolean (asked for; remove the rule to undo)', () => {
    expect(en.apply('do not bully anyone')).toBe('do not boolean anyone');
  });
  it('has enough sentences', () => {
    expect(english.length).toBeGreaterThanOrEqual(30);
    expect(french.length).toBeGreaterThanOrEqual(20);
  });
});

describe('pack files', () => {
  it('are valid word lists in the right language', () => {
    expect(parseWordList(JSON.stringify(progEn)).lang).toBe('en');
    expect(parseWordList(JSON.stringify(progFr)).lang).toBe('fr');
  });

  it('never map plain everyday words', () => {
    // Single words that are ordinary speech must only appear inside longer phrases.
    const banned = ['get', 'in', 'car', 'no', 'a', 'sink', 'wait', 'a wait', 'jason', 'sequel', 'rejects', 'red x', 'to pull', 'state', 'dome', 'for', 'four'];
    for (const p of [progEn, progFr])
      for (const r of p.rules) for (const h of r.heard) expect(banned).not.toContain(h.toLowerCase());
  });

  it('the bash and programming packs do not fight over a phrase', () => {
    for (const lang of ['en', 'fr'] as const) {
      const all = defaultRules(lang).flatMap((r) => r.heard.map((h) => h.toLowerCase()));
      expect(new Set(all).size).toBe(all.length);
    }
  });
});
