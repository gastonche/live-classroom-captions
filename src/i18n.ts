import type { Lang } from './protocol';

const en = {
  roomCode: 'Room code',
  pairHint: 'Teacher: open this site on your phone and enter the code, or scan the QR code.',
  viewHint: 'Students: open {url} and enter the code.',
  waiting: 'Waiting for teacher…',
  paused: 'Captions paused',
  interrupted: 'Captions interrupted. Teacher: check your phone.',
  ready: 'Teacher connected. Captions start soon.',
  connecting: 'Connecting…',
  offline: 'Offline. Retrying…',
  // /speak
  enterCode: 'Enter the code shown on the screen',
  connect: 'Connect',
  badCode: 'Codes are 4 letters or digits, like K7PX.',
  tv: 'Screen',
  tvConnected: 'connected',
  tvConnecting: 'connecting',
  tvOffline: 'not connected',
  tvBusy: 'Another phone is already the teacher on this screen.',
  start: 'Start captions',
  pause: 'Pause',
  resume: 'Resume',
  end: 'End',
  testText: 'Type a test caption',
  send: 'Send',
  settings: 'Settings',
  language: 'Language',
  textSize: 'Text size',
  lines: 'Lines',
  edgeMargin: 'Edge margin',
  captionsAt: 'Captions on the computer screen',
  top: 'Top',
  bottom: 'Bottom',
  dodge: 'Move out of the pointer’s way',
  mic: 'Mic',
  micOff: 'off',
  micListening: 'listening',
  micRestarting: 'restarting',
  micBlocked: 'blocked',
  engine: 'Engine',
  engineOnline: 'online',
  engineOffline: 'offline',
  errBlocked: 'Microphone blocked. Tap here to see how to allow it.',
  errBlockedHelp: 'On iPhone: tap "aA" in the address bar, then Website Settings, then Microphone: Allow. Or open Settings, then Apps, then Safari, then Microphone. Then reload this page.',
  errNeedsTap: 'Listening stopped. Tap here to carry on.',
  errUnsupported: "This browser can't recognise speech. On iPhone use Safari; on Android or a computer use Chrome.",
  errNoMic: 'No microphone found. Check that nothing else is using it, then tap here.',
  typeInstead: 'Type a caption',
  words: 'Word list',
  wordsHelp: 'One rule per line: what speech recognition writes, then =>, then what to show. Example: grip, grab => grep',
  save: 'Save',
  reset: 'Reset to default',
  importList: 'Import',
  exportList: 'Export',
  saved: 'Saved.',
  tapToFix: 'Tap a wrong word in the preview to fix it.',
  fixShow: 'Show instead of “{heard}”:',
  fixSave: 'Save fix',
  cancel: 'Cancel',
  fixSaved: 'Saved. From now on “{heard}” shows as “{write}”.',
  a2hs: 'Tip: tap Share, then "Add to Home Screen", to open Captions like an app.',
  dismiss: 'OK',
  ended: 'Session ended',
  endedHelp: 'Save the transcript or send it to your student. It is only on this phone.',
  endedEmpty: 'Nothing was captioned in this session.',
  download: 'Save as .txt',
  shareTranscript: 'Share',
  done: 'Done',
  diagnostics: 'Diagnostics',
  diagHelp: 'If something gets stuck, tap Copy and send it to whoever maintains this app. It holds mic and connection events, never your words.',
  copyDiag: 'Copy diagnostics',
  copied: 'Copied. Paste it into a message.',
  copyFailed: "Couldn't copy. Use Share instead.",
  share: 'Share',
  changeScreen: 'Use a different screen',
  notFound: 'No screen with code {code}. Check the code on the screen.',
  // desktop overlay
  cardHint: 'On your phone, open {url} and enter this code.',
  statusConnecting: 'Connecting…',
  statusOffline: 'Offline, retrying…',
  statusWaiting: 'Room {code}: no teacher connected',
  statusTeacher: 'Room {code}: teacher connected',
  statusLive: 'Room {code}: live',
  menuShowCode: 'Show room code on screen',
  menuPosition: 'Captions position',
  menuDisplay: 'Show on',
  menuProjector: 'Projector (automatic)',
  menuHide: 'Hide captions',
  menuDodge: 'Move out of the pointer’s way',
  menuAutostart: 'Open at login',
  menuQuit: 'Quit Captions',
  // /view
  viewTitle: 'Follow the captions',
  join: 'Join',
};

type Strings = typeof en;

const fr: Strings = {
  roomCode: 'Code de la salle',
  pairHint: "Enseignant : ouvrez ce site sur votre téléphone et saisissez le code, ou scannez le code QR.",
  viewHint: 'Élèves : ouvrez {url} et saisissez le code.',
  waiting: "En attente de l'enseignant…",
  paused: 'Sous-titres en pause',
  interrupted: 'Sous-titres interrompus. Enseignant : vérifiez votre téléphone.',
  ready: 'Enseignant connecté. Les sous-titres arrivent.',
  connecting: 'Connexion…',
  offline: 'Hors ligne. Nouvelle tentative…',
  enterCode: "Saisissez le code affiché à l'écran",
  connect: 'Se connecter',
  badCode: 'Le code fait 4 lettres ou chiffres, par exemple K7PX.',
  tv: 'Écran',
  tvConnected: 'connecté',
  tvConnecting: 'connexion',
  tvOffline: 'non connecté',
  tvBusy: "Un autre téléphone est déjà l'enseignant sur cet écran.",
  start: 'Démarrer les sous-titres',
  pause: 'Pause',
  resume: 'Reprendre',
  end: 'Terminer',
  testText: 'Tapez un sous-titre de test',
  send: 'Envoyer',
  settings: 'Réglages',
  language: 'Langue',
  textSize: 'Taille du texte',
  lines: 'Lignes',
  edgeMargin: 'Marge des bords',
  captionsAt: 'Sous-titres sur l’écran de l’ordinateur',
  top: 'En haut',
  bottom: 'En bas',
  dodge: 'S’écarter du pointeur',
  mic: 'Micro',
  micOff: 'éteint',
  micListening: 'écoute',
  micRestarting: 'redémarrage',
  micBlocked: 'bloqué',
  engine: 'Moteur',
  engineOnline: 'en ligne',
  engineOffline: 'hors ligne',
  errBlocked: 'Micro bloqué. Touchez ici pour savoir comment l’autoriser.',
  errBlockedHelp: 'Sur iPhone : touchez « aA » dans la barre d’adresse, puis Réglages du site web, puis Microphone : Autoriser. Ou ouvrez Réglages, puis Apps, puis Safari, puis Microphone. Rechargez ensuite la page.',
  errNeedsTap: 'L’écoute s’est arrêtée. Touchez ici pour continuer.',
  errUnsupported: 'Ce navigateur ne reconnaît pas la parole. Sur iPhone, utilisez Safari ; sur Android ou un ordinateur, Chrome.',
  errNoMic: 'Aucun micro trouvé. Vérifiez qu’aucune autre app ne l’utilise, puis touchez ici.',
  typeInstead: 'Taper un sous-titre',
  words: 'Liste de mots',
  wordsHelp: 'Une règle par ligne : ce que la reconnaissance écrit, puis =>, puis ce qu’il faut afficher. Exemple : grèpe, graipe => grep',
  save: 'Enregistrer',
  reset: 'Revenir au défaut',
  importList: 'Importer',
  exportList: 'Exporter',
  saved: 'Enregistré.',
  tapToFix: 'Touchez un mot faux dans l’aperçu pour le corriger.',
  fixShow: 'Afficher à la place de « {heard} » :',
  fixSave: 'Enregistrer',
  cancel: 'Annuler',
  fixSaved: 'Enregistré. Désormais « {heard} » s’affiche « {write} ».',
  a2hs: 'Astuce : touchez Partager, puis « Sur l’écran d’accueil », pour ouvrir Sous-titres comme une app.',
  dismiss: 'OK',
  ended: 'Séance terminée',
  endedHelp: 'Enregistrez la transcription ou envoyez-la à votre élève. Elle n’existe que sur ce téléphone.',
  endedEmpty: 'Rien n’a été sous-titré pendant cette séance.',
  download: 'Enregistrer en .txt',
  shareTranscript: 'Partager',
  done: 'Terminé',
  diagnostics: 'Diagnostic',
  diagHelp: 'Si quelque chose bloque, touchez Copier et envoyez-le à la personne qui maintient l’app. Il contient les événements du micro et de la connexion, jamais vos paroles.',
  copyDiag: 'Copier le diagnostic',
  copied: 'Copié. Collez-le dans un message.',
  copyFailed: 'Copie impossible. Utilisez Partager.',
  share: 'Partager',
  changeScreen: 'Utiliser un autre écran',
  notFound: "Aucun écran avec le code {code}. Vérifiez le code à l'écran.",
  cardHint: 'Sur votre téléphone, ouvrez {url} et saisissez ce code.',
  statusConnecting: 'Connexion…',
  statusOffline: 'Hors ligne, nouvelle tentative…',
  statusWaiting: 'Salle {code} : aucun enseignant connecté',
  statusTeacher: 'Salle {code} : enseignant connecté',
  statusLive: 'Salle {code} : en direct',
  menuShowCode: 'Afficher le code de la salle',
  menuPosition: 'Position des sous-titres',
  menuDisplay: 'Afficher sur',
  menuProjector: 'Projecteur (automatique)',
  menuHide: 'Masquer les sous-titres',
  menuDodge: 'S’écarter du pointeur',
  menuAutostart: 'Ouvrir à la connexion',
  menuQuit: 'Quitter Sous-titres',
  viewTitle: 'Suivre les sous-titres',
  join: 'Rejoindre',
};

const TABLE: Record<Lang, Strings> = { en, fr };

export function detectLang(): Lang {
  const saved = safeGet('lcc.lang');
  if (saved === 'en' || saved === 'fr') return saved;
  return (navigator.language || 'en').toLowerCase().indexOf('fr') === 0 ? 'fr' : 'en';
}

export function strings(lang: Lang): Strings {
  return TABLE[lang];
}

export function fill(s: string, vars: Record<string, string>): string {
  return s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ''));
}

/** Applies data-i18n="key" text to every marked element under root. */
export function applyStrings(root: ParentNode, s: Strings): void {
  const els = root.querySelectorAll<HTMLElement>('[data-i18n]');
  for (let i = 0; i < els.length; i++) {
    const k = els[i].getAttribute('data-i18n') as keyof Strings;
    if (k in s) els[i].textContent = s[k];
  }
  const ph = root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]');
  for (let i = 0; i < ph.length; i++) {
    const k = ph[i].getAttribute('data-i18n-placeholder') as keyof Strings;
    if (k in s) ph[i].placeholder = s[k];
  }
}

// localStorage can throw (private mode, blocked storage). Settings are a convenience.
export function safeGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function safeSet(k: string, v: string): void {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}
