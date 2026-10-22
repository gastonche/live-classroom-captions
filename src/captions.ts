// Caption renderer. Final text is append-only and interim text lives in one trailing
// span, so a new word can only rewrap the last line. Lines above never change.
// The display keeps a few paragraphs; the student view keeps everything for scroll-back.

const PARA_CHARS = 280;

export class CaptionView {
  private para!: HTMLElement;
  private finalNode!: Text;
  private interimEl!: HTMLElement;
  private paraLen = 0;
  private all = '';

  constructor(private root: HTMLElement, private maxParas = 0) {
    this.newPara();
  }

  interim(text: string): void {
    const t = this.paraLen && text ? ' ' + text : text;
    if (this.interimEl.textContent !== t) this.interimEl.textContent = t;
  }

  final(text: string): void {
    text = text.trim();
    if (!text) return;
    if (this.paraLen > PARA_CHARS) this.newPara();
    const add = (this.paraLen ? ' ' : '') + text;
    this.finalNode.appendData(add);
    this.paraLen += add.length;
    this.all += (this.all ? ' ' : '') + text;
    this.interimEl.textContent = '';
  }

  /** Full transcript of finalised text, for late-joining viewers and downloads. */
  get transcript(): string {
    return this.all;
  }

  load(text: string): void {
    this.clear();
    this.final(text);
  }

  clear(): void {
    this.root.textContent = '';
    this.all = '';
    this.newPara();
  }

  private newPara(): void {
    // Finish the old paragraph's interim span before moving on.
    if (this.interimEl) this.interimEl.textContent = '';
    this.para = document.createElement('p');
    this.para.className = 'cap';
    this.finalNode = document.createTextNode('');
    this.interimEl = document.createElement('span');
    this.interimEl.className = 'interim';
    this.para.appendChild(this.finalNode);
    this.para.appendChild(this.interimEl);
    this.root.appendChild(this.para);
    this.paraLen = 0;
    if (this.maxParas) while (this.root.childNodes.length > this.maxParas) this.root.removeChild(this.root.firstChild!);
  }
}
